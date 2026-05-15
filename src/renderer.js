import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.js";

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

function wrapText(text, maxChars = 22, maxLines = 7) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines).join("\n");
}

function fontFile() {
  if (process.platform === "win32") return "C:/Windows/Fonts/arialbd.ttf";
  return "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
}

function ffPath(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/:/g, "\\\\:");
}

function filterFilePath(filePath) {
  return path.relative(config.rootDir, filePath).replace(/\\/g, "/").replace(/:/g, "\\:");
}

function fontOption() {
  return `fontfile=${ffPath(fontFile())}`;
}

function textFontSize(text) {
  const longest = Math.max(...String(text || "").split(/\n/).map((line) => line.length), 1);
  const estimated = Math.floor(980 / (longest * 0.55));
  return Math.max(50, Math.min(84, estimated));
}

function durationForScene(totalDuration, count) {
  return Math.max(3, Number((totalDuration / Math.max(1, count)).toFixed(2)));
}

function clampDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return 24;
  return Math.max(config.video.minDurationSeconds, Math.min(config.video.maxDurationSeconds, duration));
}

async function renderScene({ scene, title, scenePath, textPath, brandPath, duration }) {
  const text = wrapText(scene.text);
  await fs.writeFile(textPath, text, "utf8");
  await fs.writeFile(brandPath, `${title}\nInstaForge AI`, "utf8");

  const font = fontOption();
  const escapedTextPath = filterFilePath(textPath);
  const escapedBrandPath = filterFilePath(brandPath);
  const accent = "0x2dd4bf";
  const fontSize = textFontSize(text);
  const filters = [
    `drawbox=x=72:y=126:w=936:h=8:color=${accent}:t=fill`,
    `drawbox=x=72:y=1776:w=936:h=4:color=${accent}:t=fill`,
    `drawtext=${font}:textfile=${escapedBrandPath}:fontcolor=white@0.78:fontsize=34:line_spacing=8:x=78:y=154`,
    `drawtext=${font}:textfile=${escapedTextPath}:fontcolor=white:fontsize=${fontSize}:line_spacing=22:box=1:boxcolor=black@0.38:boxborderw=38:x=(w-text_w)/2:y=(h-text_h)/2`,
    "format=yuv420p"
  ].join(",");

  await runCommand("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    "lavfi",
    "-i",
    `color=c=${scene.color}:s=${config.video.width}x${config.video.height}:d=${duration}:r=${config.video.fps}`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf",
    filters,
    "-shortest",
    "-t",
    String(duration),
    "-c:v",
    "libx264",
    "-preset",
    config.video.preset,
    "-crf",
    String(config.video.crf),
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    scenePath
  ], { cwd: config.rootDir });
}

export async function renderVideo({ jobId, plan, durationSeconds }) {
  const duration = clampDuration(durationSeconds || plan.durationSeconds);
  const workDir = path.join(config.tmpDir, jobId);
  await fs.mkdir(workDir, { recursive: true });

  const scenes = plan.scenes || [];
  const sceneDuration = durationForScene(duration, scenes.length);
  const sceneFiles = [];

  for (const [index, scene] of scenes.entries()) {
    const scenePath = path.join(workDir, `scene-${String(index + 1).padStart(2, "0")}.mp4`);
    await renderScene({
      scene,
      title: plan.title,
      scenePath,
      textPath: path.join(workDir, `scene-${index + 1}.txt`),
      brandPath: path.join(workDir, `brand-${index + 1}.txt`),
      duration: sceneDuration
    });
    sceneFiles.push(scenePath);
  }

  const concatFile = path.join(workDir, "concat.txt");
  const concatBody = sceneFiles
    .map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.writeFile(concatFile, `${concatBody}\n`, "utf8");

  const baseName = `${jobId}-${safeName(plan.title)}`;
  const videoPath = path.join(config.videoDir, `${baseName}.mp4`);
  const thumbnailPath = path.join(config.thumbnailDir, `${baseName}.jpg`);
  await fs.mkdir(config.videoDir, { recursive: true });
  await fs.mkdir(config.thumbnailDir, { recursive: true });

  await runCommand("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFile,
    "-c",
    "copy",
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

  return {
    videoPath,
    thumbnailPath,
    durationSeconds: duration,
    width: config.video.width,
    height: config.video.height
  };
}

export async function assertFfmpegAvailable() {
  await runCommand("ffmpeg", ["-version"]);
  await runCommand("ffprobe", ["-version"]);
}
