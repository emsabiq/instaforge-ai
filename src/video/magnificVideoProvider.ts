import axios from "axios";
import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import { downloadToFile, isHttpUrl } from "../utils/http.js";
import { runCommand } from "../utils/process.js";
import type { VideoInput, VideoProvider, VideoResult } from "./videoProvider.js";

interface MagnificVideoProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  ffmpegPath?: string;
}

const referenceToVideoEndpoint = "/reference-to-video/happy-horse-1";

export class MagnificVideoProvider implements VideoProvider {
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly ffmpegPath: string;

  constructor(config: MagnificVideoProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.VIDEO_PROVIDER_API_KEY || process.env.MAGNIFIC_API_KEY;
    this.baseUrl = (
      config.baseUrl ||
      process.env.VIDEO_PROVIDER_BASE_URL ||
      process.env.MAGNIFIC_BASE_URL ||
      "https://api.magnific.com"
    ).replace(/\/$/, "");
    this.ffmpegPath = config.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg";
  }

  async generateVideo(input: VideoInput): Promise<VideoResult> {
    await ensureDir(input.outputDir);

    if (this.apiKey && this.baseUrl && isHttpUrl(input.frame1) && isHttpUrl(input.frame2)) {
      return this.generateWithReferenceToVideo(input);
    }

    return this.generateStubWithFfmpeg(input);
  }

  private async generateWithReferenceToVideo(input: VideoInput): Promise<VideoResult> {
    const outputPath = path.join(input.outputDir, `${input.projectId}-video.mp4`);
    const payload = {
      prompt: [
        "character1 is the opening reference image.",
        "character2 is the target ending reference image.",
        input.prompt,
        "Animate character1 toward the visual direction of character2 while preserving identity and cinematic realism."
      ].join(" "),
      image_urls: [{ url: input.frame1 }, { url: input.frame2 }],
      aspect_ratio: "16:9",
      resolution: "1080P",
      duration: input.durationSeconds,
      watermark: false
    };

    const response = await axios.post(this.apiUrl(referenceToVideoEndpoint), payload, {
      headers: {
        "content-type": "application/json",
        "x-magnific-api-key": this.apiKey
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const initial = response.data as unknown;
    const immediateUrl = this.extractUrl(initial);
    if (immediateUrl) {
      await downloadToFile(immediateUrl, outputPath);
      return {
        path: outputPath,
        url: immediateUrl,
        provider: "magnific-happy-horse-1",
        metadata: this.asMetadata(initial)
      };
    }

    const taskId = this.extractJobId(initial);
    if (!taskId) {
      throw new Error("Magnific Happy Horse response did not include a video URL or task_id");
    }

    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const poll = await axios.get(this.apiUrl(`${referenceToVideoEndpoint}/${taskId}`), {
        headers: { "x-magnific-api-key": this.apiKey }
      });
      const data = poll.data as unknown;
      const status = this.extractStatus(data)?.toUpperCase();

      if (status === "FAILED") {
        throw new Error("Magnific Happy Horse video job failed");
      }

      const url = this.extractUrl(data);
      if (status === "COMPLETED" && url) {
        await downloadToFile(url, outputPath);
        return {
          path: outputPath,
          url,
          provider: "magnific-happy-horse-1",
          metadata: this.asMetadata(data)
        };
      }
    }

    throw new Error("Timed out waiting for Magnific Happy Horse video job");
  }

  private async generateStubWithFfmpeg(input: VideoInput): Promise<VideoResult> {
    const outputPath = path.join(input.outputDir, `${input.projectId}-stub-video.mp4`);
    const transitionSeconds = Math.min(1, Math.max(0.25, input.durationSeconds / 8));
    const inputSeconds = (input.durationSeconds + transitionSeconds) / 2;
    const offsetSeconds = inputSeconds - transitionSeconds;

    const filter = [
      "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=rgba[v0]",
      "[1:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=rgba[v1]",
      `[v0][v1]xfade=transition=fade:duration=${transitionSeconds}:offset=${offsetSeconds},format=yuv420p[v]`
    ].join(";");

    await runCommand(this.ffmpegPath, [
      "-y",
      "-loop",
      "1",
      "-t",
      String(inputSeconds),
      "-i",
      input.frame1,
      "-loop",
      "1",
      "-t",
      String(inputSeconds),
      "-i",
      input.frame2,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-t",
      String(input.durationSeconds),
      "-r",
      "24",
      "-movflags",
      "+faststart",
      outputPath
    ]);

    return {
      path: outputPath,
      provider: "magnific-video-stub",
      metadata: {
        note: "Happy Horse needs public frame URLs. Falling back to FFmpeg stub because one or both frame inputs were local paths."
      }
    };
  }

  private extractUrl(data: unknown): string | null {
    return this.findString(data, ["video_url", "videoUrl", "output_url", "outputUrl", "url", "generated"]);
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
    if (!this.baseUrl) {
      throw new Error("Magnific base URL is not configured");
    }

    if (this.baseUrl.endsWith("/v1/ai")) {
      return `${this.baseUrl}${pathname}`;
    }

    if (this.baseUrl.endsWith("/v1")) {
      return `${this.baseUrl}/ai${pathname}`;
    }

    return `${this.baseUrl}/v1/ai${pathname}`;
  }

  private asMetadata(data: unknown): Record<string, unknown> | undefined {
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  }
}
