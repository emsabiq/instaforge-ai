import axios from "axios";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { ensureDir } from "../utils/fs.js";
import { isHttpUrl } from "../utils/http.js";
import type {
  CreateFrameOptions,
  EnhanceImageOptions,
  ImageProvider,
  ImageResult
} from "./imageProvider.js";

interface MagnificImageProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

const frameEndpoint = "/text-to-image/seedream-v5-lite-edit";
const enhanceEndpoint = "/image-upscaler-precision-v2";
const minimumImageBytes = 1024;

export class MagnificImageProvider implements ImageProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: MagnificImageProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.MAGNIFIC_API_KEY;
    this.baseUrl = (config.baseUrl || process.env.MAGNIFIC_BASE_URL || "https://api.magnific.com").replace(
      /\/$/,
      ""
    );
  }

  async createFrameFromBase(
    baseImage: string,
    instruction: string,
    options: CreateFrameOptions = {}
  ): Promise<ImageResult> {
    this.assertConfigured();

    const outputDir = options.outputDir || "generated/images";
    const outputFileName = options.outputFileName || `frame-${Date.now()}.jpg`;
    const outputPath = path.join(outputDir, outputFileName);
    await ensureDir(outputDir);

    const payload = {
      prompt: instruction,
      reference_images: [await this.imageInput(baseImage)],
      aspect_ratio: "widescreen_16_9",
      enable_safety_checker: true
    };

    const data = await this.postAndResolve(frameEndpoint, payload);
    await this.persistImageResult(data, outputPath);

    return {
      path: outputPath,
      url: this.extractUrl(data) || undefined,
      provider: "magnific-seedream-v5-lite-edit",
      metadata: this.asMetadata(data)
    };
  }

  async enhanceImage(image: string, options: EnhanceImageOptions = {}): Promise<ImageResult> {
    this.assertConfigured();

    const outputDir = options.outputDir || "generated/images";
    const outputFileName = options.outputFileName || `enhanced-${Date.now()}.jpg`;
    const outputPath = path.join(outputDir, outputFileName);
    await ensureDir(outputDir);

    const payload = {
      image: await this.imageInput(image),
      sharpen: 7,
      smart_grain: 7,
      ultra_detail: 30,
      flavor: "photo",
      scale_factor: options.upscale || 2,
      filter_nsfw: false
    };

    const data = await this.postAndResolve(enhanceEndpoint, payload);
    await this.persistImageResult(data, outputPath);

    return {
      path: outputPath,
      url: this.extractUrl(data) || undefined,
      provider: "magnific-upscaler-precision-v2",
      metadata: this.asMetadata(data)
    };
  }

  private async postAndResolve(pathname: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await axios.post(this.apiUrl(pathname), payload, {
      headers: {
        "content-type": "application/json",
        "x-magnific-api-key": this.apiKey
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const initial = response.data as unknown;
    if (this.extractUrl(initial) || this.extractBase64(initial)) {
      return initial;
    }

    const taskId = this.extractJobId(initial);
    if (!taskId) {
      throw new Error("Magnific response did not include an image URL or task_id");
    }

    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const poll = await axios.get(this.apiUrl(`${pathname}/${taskId}`), {
        headers: { "x-magnific-api-key": this.apiKey }
      });
      const data = poll.data as unknown;
      const status = this.extractStatus(data)?.toUpperCase();

      if (status === "FAILED") {
        throw new Error("Magnific image job failed");
      }

      if (status === "COMPLETED" && (this.extractUrl(data) || this.extractBase64(data))) {
        return data;
      }
    }

    throw new Error("Timed out waiting for Magnific image job");
  }

  private async persistImageResult(data: unknown, outputPath: string): Promise<void> {
    const base64 = this.extractBase64(data);
    if (base64) {
      await writeFile(outputPath, Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), "base64"));
      return;
    }

    const url = this.extractUrl(data);
    if (!url) {
      throw new Error("Magnific response did not include a downloadable image");
    }

    await this.downloadGeneratedImage(url, outputPath);
  }

  private async downloadGeneratedImage(url: string, outputPath: string): Promise<void> {
    let lastError = "unknown error";

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
          }
        });
        const contentType = response.headers.get("content-type") || "unknown";
        const buffer = Buffer.from(await response.arrayBuffer());

        if (!response.ok) {
          lastError = `HTTP ${response.status} ${response.statusText}`;
        } else if (!this.isValidImageBuffer(buffer)) {
          lastError = `invalid image payload: ${buffer.length} bytes, content-type ${contentType}`;
        } else {
          await writeFile(outputPath, buffer);
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error(`Magnific generated image was not downloadable: ${lastError}`);
  }

  private isValidImageBuffer(buffer: Buffer): boolean {
    if (buffer.length < minimumImageBytes) {
      return false;
    }

    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    const isWebp = buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";

    return isJpeg || isPng || isWebp;
  }

  private async imageInput(image: string): Promise<string> {
    if (isHttpUrl(image)) {
      return image;
    }

    throw new Error("Magnific Seedream requires a public reference image URL");
  }

  private extractUrl(data: unknown): string | null {
    return this.findString(data, ["image_url", "imageUrl", "output_url", "outputUrl", "url", "generated"]);
  }

  private extractBase64(data: unknown): string | null {
    return this.findStringByKey(data, ["image_base64", "imageBase64", "base64", "b64_json"]);
  }

  private extractJobId(data: unknown): string | null {
    return this.findStringByKey(data, ["id", "job_id", "jobId", "task_id", "taskId"]);
  }

  private extractStatus(data: unknown): string | null {
    return this.findStringByKey(data, ["status", "state", "task_status", "taskStatus"]);
  }

  private findString(data: unknown, keys: string[]): string | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === "string" && item.trim() !== "") {
          return item;
        }

        const value = this.findString(item, keys);
        if (value) {
          return value;
        }
      }
      return null;
    }

    const record = data as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") {
        return value;
      }

      if (Array.isArray(value)) {
        const first = this.findString(value, keys);
        if (first) {
          return first;
        }
      }
    }

    for (const value of Object.values(record)) {
      const nested = this.findString(value, keys);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  private findStringByKey(data: unknown, keys: string[]): string | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        const value = this.findStringByKey(item, keys);
        if (value) {
          return value;
        }
      }
      return null;
    }

    const record = data as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") {
        return value;
      }

      if (Array.isArray(value)) {
        const first = value.find((item): item is string => typeof item === "string" && item.trim() !== "");
        if (first) {
          return first;
        }
      }
    }

    for (const value of Object.values(record)) {
      const nested = this.findStringByKey(value, keys);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  private apiUrl(pathname: string): string {
    if (this.baseUrl.endsWith("/v1/ai")) {
      return `${this.baseUrl}${pathname}`;
    }

    if (this.baseUrl.endsWith("/v1")) {
      return `${this.baseUrl}/ai${pathname}`;
    }

    return `${this.baseUrl}/v1/ai${pathname}`;
  }

  private assertConfigured(): void {
    if (!this.apiKey) {
      throw new Error("MAGNIFIC_API_KEY is required for image generation");
    }
  }

  private asMetadata(data: unknown): Record<string, unknown> | undefined {
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  }
}
