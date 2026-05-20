import axios from "axios";
import FormData from "form-data";
import { createReadStream } from "node:fs";
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

export class MagnificVideoProvider implements VideoProvider {
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly ffmpegPath: string;

  constructor(config: MagnificVideoProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.VIDEO_PROVIDER_API_KEY;
    this.baseUrl = (config.baseUrl || process.env.VIDEO_PROVIDER_BASE_URL || "").replace(/\/$/, "");
    this.ffmpegPath = config.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg";
  }

  async generateVideo(input: VideoInput): Promise<VideoResult> {
    await ensureDir(input.outputDir);

    if (this.apiKey && this.baseUrl) {
      return this.generateWithApi(input);
    }

    return this.generateStubWithFfmpeg(input);
  }

  private async generateWithApi(input: VideoInput): Promise<VideoResult> {
    const outputPath = path.join(input.outputDir, `${input.projectId}-video.mp4`);
    const form = new FormData();
    form.append("prompt", input.prompt);
    form.append("duration", String(input.durationSeconds));
    this.appendImage(form, "frame1", input.frame1);
    this.appendImage(form, "frame2", input.frame2);

    const response = await axios.post(this.apiUrl("/videos/generate"), form, {
      headers: {
        ...form.getHeaders(),
        authorization: `Bearer ${this.apiKey}`
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
        provider: "magnific-video",
        metadata: this.asMetadata(initial)
      };
    }

    const jobId = this.extractJobId(initial);
    if (!jobId) {
      throw new Error("Video provider response did not include a video URL or job id");
    }

    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const poll = await axios.get(this.apiUrl(`/jobs/${jobId}`), {
        headers: { authorization: `Bearer ${this.apiKey}` }
      });
      const data = poll.data as unknown;
      const status = this.extractStatus(data);

      if (status === "failed" || status === "error") {
        throw new Error("Video provider job failed");
      }

      const url = this.extractUrl(data);
      if (url) {
        await downloadToFile(url, outputPath);
        return {
          path: outputPath,
          url,
          provider: "magnific-video",
          metadata: this.asMetadata(data)
        };
      }
    }

    throw new Error("Timed out waiting for video provider job");
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
        note: "VIDEO_PROVIDER_BASE_URL and VIDEO_PROVIDER_API_KEY are not set, so FFmpeg stub output was generated."
      }
    };
  }

  private appendImage(form: FormData, fieldName: string, image: string): void {
    if (isHttpUrl(image)) {
      form.append(`${fieldName}_url`, image);
      return;
    }

    form.append(fieldName, createReadStream(image), path.basename(image));
  }

  private extractUrl(data: unknown): string | null {
    return this.findString(data, ["video_url", "videoUrl", "output_url", "outputUrl", "url"]);
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
    if (!this.baseUrl) {
      throw new Error("VIDEO_PROVIDER_BASE_URL is not configured");
    }

    if (this.baseUrl.endsWith("/v1")) {
      return `${this.baseUrl}${pathname}`;
    }
    return `${this.baseUrl}/v1${pathname}`;
  }

  private asMetadata(data: unknown): Record<string, unknown> | undefined {
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  }
}
