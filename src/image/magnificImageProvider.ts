import axios from "axios";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { ensureDir } from "../utils/fs.js";
import { downloadToFile, isHttpUrl } from "../utils/http.js";
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
      aspect_ratio: "original",
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

    await downloadToFile(url, outputPath);
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
    return this.findString(data, ["image_base64", "imageBase64", "base64", "b64_json"]);
  }

  private extractJobId(data: unknown): string | null {
    return this.findString(data, ["id", "job_id", "jobId", "task_id", "taskId"]);
  }

  private extractStatus(data: unknown): string | null {
    return this.findString(data, ["status", "state", "task_status", "taskStatus"]);
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
