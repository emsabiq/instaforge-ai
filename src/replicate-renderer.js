import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import Replicate from "replicate";
import { config } from "./config.js";
import { buildReplicatePrompt, childSafeNegativePrompt } from "./storyboard.js";

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited ${code}: ${stderr || stdout}`.trim()));
    });
  });
}

function safeName(value) {
  return String(value || "video")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "video";
}

function clampDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return 15;
  return Math.max(config.video.minDurationSeconds, Math.min(config.video.maxDurationSeconds, duration));
}

function normalizeAspectRatio(value) {
  const text = String(value || config.video.aspectRatio || "16:9").toLowerCase();
  if (["landscape", "wide", "16x9", "16:9"].includes(text)) return "16:9";
  if (["portrait", "vertical", "9x16", "9:16"].includes(text)) return "9:16";
  if (["square", "1x1", "1:1"].includes(text)) return "1:1";
  return "16:9";
}

function targetDimensions(aspectRatio) {
  const width = Number(config.video.width);
  const height = Number(config.video.height);
  if (aspectRatio === "16:9") {
    return width > height ? { width, height } : { width: 1280, height: 720 };
  }
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return height > width ? { width, height } : { width: 1080, height: 1920 };
}

function outputUrl(output) {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return outputUrl(output[0]);
  if (typeof output.url === "function") return String(output.url());
  if (typeof output.url === "string") return output.url;
  const text = String(output);
  return /^https?:\/\//i.test(text) ? text : "";
}

function nearestLtxFastDuration(duration) {
  const allowed = [6, 8, 10, 12, 14, 16, 18, 20];
  return allowed.find((item) => item >= duration) || 20;
}

function buildModelInput({ model, prompt, durationSeconds, aspectRatio }) {
  const fps = Math.max(1, Math.round(config.replicate.fps || 24));
  if (/ltx-2\.3/i.test(model)) {
    return {
      prompt,
      duration: nearestLtxFastDuration(durationSeconds),
      resolution: config.replicate.resolution || "1080p",
      aspect_ratio: aspectRatio === "9:16" ? "9:16" : "16:9",
      fps: [24, 25, 48, 50].includes(fps) ? fps : 24,
      camera_motion: config.replicate.cameraMotion || "dolly_in",
      generate_audio: Boolean(config.replicate.generateAudio)
    };
  }

  const maxFrames = 257;
  const requestedFrames = Math.round(durationSeconds * fps) + 1;
  if (requestedFrames > maxFrames) {
    throw new Error(
      "Model LTX distilled maksimal sekitar 10 detik. Pakai REPLICATE_VIDEO_MODEL=lightricks/ltx-2.3-fast untuk test 15 detik."
    );
  }

  const resolution = Number(config.replicate.resolution) || 720;
  return {
    prompt,
    fps,
    num_frames: Math.max(9, Math.min(maxFrames, requestedFrames)),
    resolution: [480, 720].includes(resolution) ? resolution : 720,
    aspect_ratio: aspectRatio,
    guidance_scale: 3.2,
    negative_prompt: childSafeNegativePrompt(),
    num_inference_steps: 24,
    final_inference_steps: 10,
    go_fast: true
  };
}

async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Gagal download output Replicate (${response.status}).`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, body);
}

async function mediaDuration(filePath) {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  const duration = Number(stdout.trim());
  return Number.isFinite(duration) ? duration : 0;
}

async function finalizeVideo({ inputPath, videoPath, thumbnailPath, durationSeconds, width, height }) {
  const actualDuration = await mediaDuration(inputPath).catch(() => 0);
  const stopPad = Math.max(0, durationSeconds - actualDuration);
  const filters = [
    `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
    `fps=${config.video.fps}`,
    stopPad > 0.1 ? `tpad=stop_mode=clone:stop_duration=${stopPad.toFixed(2)}` : "",
    "format=yuv420p"
  ].filter(Boolean).join(",");

  await runCommand("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    filters,
    "-t",
    String(durationSeconds),
    "-c:v",
    "libx264",
    "-preset",
    config.video.preset,
    "-crf",
    String(config.video.crf),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    videoPath
  ]);

  await runCommand("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-ss",
    "00:00:01",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    thumbnailPath
  ]);
}

export async function renderReplicateVideo({ jobId, plan, durationSeconds, aspectRatio }) {
  if (!config.replicate.apiKey) {
    throw new Error("REPLICATE_API_TOKEN belum diset.");
  }

  const duration = clampDuration(durationSeconds || plan.durationSeconds || 15);
  const normalizedAspect = normalizeAspectRatio(aspectRatio);
  const { width, height } = targetDimensions(normalizedAspect);
  const workDir = path.join(config.tmpDir, jobId);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(config.videoDir, { recursive: true });
  await fs.mkdir(config.thumbnailDir, { recursive: true });

  const model = config.replicate.model || "lightricks/ltx-2.3-fast";
  const prompt = buildReplicatePrompt({ plan, durationSeconds: duration, aspectRatio: normalizedAspect });
  const input = buildModelInput({ model, prompt, durationSeconds: duration, aspectRatio: normalizedAspect });
  if (config.replicate.seed) input.seed = Number(config.replicate.seed);

  console.log("REPLICATE MODEL:", model);
  console.log("REPLICATE ASPECT:", normalizedAspect);
  console.log("REPLICATE DURATION:", duration);

  const replicate = new Replicate({
    auth: config.replicate.apiKey,
    useFileOutput: false,
    userAgent: "instaforge-ai"
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.replicate.timeoutMs);
  let output;
  try {
    output = await replicate.run(model, {
      input,
      signal: controller.signal,
      wait: {
        mode: "poll",
        interval: 3000
      }
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/insufficient credit|payment required/i.test(message)) {
      throw new Error("Replicate gagal: credit tidak cukup. Tambahkan billing/credit di akun Replicate lalu coba lagi.");
    }
    throw new Error(message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]"));
  } finally {
    clearTimeout(timeout);
  }

  const sourceUrl = outputUrl(output);
  if (!sourceUrl) {
    throw new Error("Replicate selesai tetapi URL video tidak ditemukan.");
  }

  const rawPath = path.join(workDir, "replicate-output.mp4");
  await downloadFile(sourceUrl, rawPath);

  const baseName = `${jobId}-${safeName(plan.title)}`;
  const videoPath = path.join(config.videoDir, `${baseName}.mp4`);
  const thumbnailPath = path.join(config.thumbnailDir, `${baseName}.jpg`);
  await finalizeVideo({
    inputPath: rawPath,
    videoPath,
    thumbnailPath,
    durationSeconds: duration,
    width,
    height
  });

  return {
    videoPath,
    thumbnailPath,
    durationSeconds: duration,
    width,
    height,
    engine: "replicate",
    model,
    aspectRatio: normalizedAspect,
    sourceUrl,
    replicateInput: {
      ...input,
      prompt
    }
  };
}
