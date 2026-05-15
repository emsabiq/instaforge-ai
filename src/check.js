import { spawn } from "node:child_process";
import { config, shouldUploadToRemote } from "./config.js";

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function check(name, ok, detail = "", required = true) {
  return { name, ok: Boolean(ok), detail, required };
}

function remoteMissing() {
  if (!shouldUploadToRemote()) return [];
  const prefix = config.ftp.envPrefix;
  const missing = [];
  if (!config.ftp.host) missing.push(`${prefix}_HOST`);
  if (!config.ftp.user) missing.push(`${prefix}_USER`);
  if (!config.ftp.password && !config.ftp.privateKey) missing.push(`${prefix}_PASSWORD`);
  if (!config.ftp.remoteDir) missing.push(`${prefix}_REMOTE_DIR`);
  return missing;
}

const ffmpegOk = await commandExists("ffmpeg");
const ffprobeOk = await commandExists("ffprobe");
const missingRemote = remoteMissing();

const checks = [
  check("OPENAI_API_KEY", Boolean(config.openai.apiKey), "dibutuhkan untuk rencana video AI"),
  check("PUBLIC_BASE_URL", Boolean(config.publicBaseUrl), config.publicBaseUrl),
  check("Remote storage", !missingRemote.length, missingRemote.length ? `missing: ${missingRemote.join(", ")}` : config.ftp.label),
  check("Instagram user", Boolean(config.instagram.igUserId), "INSTAGRAM_IG_USER_ID"),
  check("Instagram token", Boolean(config.instagram.accessToken), "INSTAGRAM_ACCESS_TOKEN"),
  check("FFmpeg", ffmpegOk, "render MP4"),
  check("FFprobe", ffprobeOk, "validasi media"),
  check("Auto publish", config.autoPublish && !config.dryRun, config.dryRun ? "DRY_RUN=true" : "AUTO_PUBLISH=true", false)
];

for (const item of checks) {
  const label = item.ok ? "OK  " : item.required ? "FAIL" : "WARN";
  console.log(`${label} ${item.name}${item.detail ? ` - ${item.detail}` : ""}`);
}

const failed = checks.filter((item) => !item.ok && item.required);
if (failed.length) {
  process.exitCode = 1;
}
