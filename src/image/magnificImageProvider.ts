import axios from "axios";
import FormData from "form-data";
import { createReadStream } from "node:fs";
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

export class MagnificImageProvider implements ImageProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: MagnificImageProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.MAGNIFIC_API_KEY;
    this.baseUrl = (config.baseUrl || process.env.MAGNIFIC_BASE_URL || "https://api.magnific.ai").replace(
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

    const form = new FormData();
    form.append("prompt", instruction);
    form.append("instruction", instruction);
    form.append("mode", "edit");
    if (options.width) {
      form.append("width", String(options.width));
    }
    if (options.height) {
      form.append("height", String(options.height));
    }
    if (options.style) {
      form.append("style", options.style);
    }
    this.appendImage(form, baseImage);

    const data = await this.postAndResolve("/images/edit", form);
    await this.persistImageResult(data, outputPath);

    return {
      path: outputPath,
      url: this.extractUrl(data) || undefined,
      provider: "magnific",
      metadata: this.asMetadata(data)
    };
  }

  async enhanceImage(image: string, options: EnhanceImageOptions = {}): Promise<ImageResult> {
    this.assertConfigured();

    const outputDir = options.outputDir || "generated/images";
    const outputFileName = options.outputFileName || `enhanced-${Date.now()}.jpg`;
    const outputPath = path.join(outputDir, outputFileName);
    await ensureDir(outputDir);

    const form = new FormData();
    form.append("mode", "enhance");
    if (options.upscale) {
      form.append("upscale", String(options.upscale));
    }
    this.appendImage(form, image);

    const data = await this.postAndResolve("/images/enhance", form);
    await this.persistImageResult(data, outputPath);

    return {
      path: outputPath,
      url: this.extractUrl(data) || undefined,
      provider: "magnific",
      metadata: this.asMetadata(data)
    };
  }

  private async postAndResolve(pathname: string, form: FormData): Promise<unknown> {
    const response = await axios.post(this.apiUrl(pathname), form, {
      headers: {
        ...form.getHeaders(),
        authorization: `Bearer ${this.apiKey}`
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const initial = response.data as unknown;
    const immediateUrl = this.extractUrl(initial);
    const immediateBase64 = this.extractBase64(initial);
    if (immediateUrl || immediateBase64) {
      return initial;
    }

    const jobId = this.extractJobId(initial);
    if (!jobId) {
      throw new Error("Magnific response did not include an image URL or job id");
    }

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const poll = await axios.get(this.apiUrl(`/jobs/${jobId}`), {
        headers: { authorization: `Bearer ${this.apiKey}` }
      });
      const data = poll.data as unknown;
      const status = this.extractStatus(data);

      if (status === "failed" || status === "error") {
        throw new Error("Magnific image job failed");
      }

      if (this.extractUrl(data) || this.extractBase64(data)) {
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

  private appendImage(form: FormData, image: string): void {
    if (isHttpUrl(image)) {
      form.append("image_url", image);
      return;
    }

    form.append("image", createReadStream(image), path.basename(image));
  }

  private extractUrl(data: unknown): string | null {
    return this.findString(data, ["image_url", "imageUrl", "output_url", "outputUrl", "url"]);
  }

  private extractBase64(data: unknown): string | null {
    return this.findString(data, ["image_base64", "imageBase64", "base64", "b64_json"]);
  }

  private extractJobId(data: unknown): string | null {
    return this.findString(data, ["id", "job_id", "jobId", "task_id", "taskId"]);
  }

  private extractStatus(data: unknown): string | null {
    return this.findString(data, ["status", "state"]);
  }

  private findString(data: unknown, keys: string[]): string | null {
    if (!data || typeof data !== "object") {
      return null;
    }

    if (Array.isArray(data)) {
      for (const item of data) {
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
    if (this.baseUrl.endsWith("/v1")) {
      return `${this.baseUrl}${pathname}`;
    }
    return `${this.baseUrl}/v1${pathname}`;
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
