import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export function clean(value) {
  return String(value || "").trim();
}

export function cleanBaseUrl(value) {
  return clean(value).replace(/\/+$/, "");
}

export function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function firstEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function numberEnvFrom(names, fallback) {
  const value = Number(firstEnv(names));
  return Number.isFinite(value) ? value : fallback;
}

function remoteConfig() {
  const driver = clean(process.env.UPLOAD_DRIVER || "sftp").toLowerCase();
  const prefix = driver === "sftp" ? "SFTP" : "FTP";
  const fallbackPrefix = prefix === "SFTP" ? "FTP" : "SFTP";
  const names = (suffix) => [`${prefix}_${suffix}`, `${fallbackPrefix}_${suffix}`];
  const portNames = driver === "sftp" ? ["SFTP_PORT"] : names("PORT");
  const defaultPort = driver === "sftp" ? 65002 : 21;

  return {
    driver,
    label: driver === "sftp" ? "SFTP" : "FTP",
    envPrefix: prefix,
    host: clean(firstEnv(names("HOST"))),
    port: numberEnvFrom(portNames, defaultPort),
    user: clean(firstEnv(names("USER"))),
    password: firstEnv(names("PASSWORD")),
    privateKey: firstEnv(["SFTP_PRIVATE_KEY"]).replace(/\\n/g, "\n").trim(),
    passphrase: firstEnv(["SFTP_PASSPHRASE"]),
    remoteDir: clean(firstEnv(names("REMOTE_DIR"), "/public_html/instaforge-ai")),
    timeoutMs: numberEnvFrom(names("TIMEOUT_SECONDS"), 30) * 1000,
    uploadTimeoutMs: numberEnvFrom(names("UPLOAD_TIMEOUT_SECONDS"), 900) * 1000,
    retries: Math.max(1, numberEnvFrom(names("UPLOAD_RETRIES"), 4)),
    publicUrlRetries: Math.max(1, numberEnvFrom(names("PUBLIC_URL_RETRIES"), 8)),
    publicUrlRetryDelayMs: Math.max(250, numberEnvFrom(names("PUBLIC_URL_RETRY_DELAY_MS"), 2500))
  };
}

function buildConfig() {
  const width = numberEnv("VIDEO_WIDTH", 1080);
  const height = numberEnv("VIDEO_HEIGHT", 1920);

  return {
    appName: "InstaForge AI",
    rootDir,
    publicDir: path.join(rootDir, "public"),
    dataDir: path.join(rootDir, "data"),
    generatedDir: path.join(rootDir, "generated"),
    videoDir: path.join(rootDir, "generated", "videos"),
    thumbnailDir: path.join(rootDir, "generated", "thumbnails"),
    metadataDir: path.join(rootDir, "generated", "metadata"),
    tmpDir: path.join(rootDir, "generated", "tmp"),
    timezone: clean(process.env.APP_TIMEZONE || "Asia/Jakarta"),
    dryRun: boolEnv("DRY_RUN", true),
    autoPublish: boolEnv("AUTO_PUBLISH", false),
    publicBaseUrl: cleanBaseUrl(process.env.PUBLIC_BASE_URL),
    uploadDriver: clean(process.env.UPLOAD_DRIVER || "sftp").toLowerCase(),
    remoteUploadRequired: boolEnv("REMOTE_UPLOAD_REQUIRED", true),
    graphApiVersion: clean(process.env.GRAPH_API_VERSION || "v25.0"),
    dashboard: {
      pin: clean(process.env.AUTO_DASHBOARD_PIN),
      githubRepo: clean(process.env.DASHBOARD_GITHUB_REPO || process.env.GITHUB_REPOSITORY),
      workflowFile: clean(process.env.DASHBOARD_WORKFLOW_FILE || "instagram-ai-video.yml"),
      ref: clean(process.env.DASHBOARD_GITHUB_REF || "main")
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      model: clean(process.env.OPENAI_MODEL || "gpt-4.1-nano"),
      temperature: numberEnv("OPENAI_TEMPERATURE", 0.45),
      requestTimeoutMs: numberEnv("AI_REQUEST_TIMEOUT_SECONDS", 40) * 1000
    },
    video: {
      width,
      height,
      fps: numberEnv("VIDEO_FPS", 30),
      crf: numberEnv("VIDEO_RENDER_CRF", 24),
      preset: clean(process.env.VIDEO_RENDER_PRESET || "veryfast"),
      minDurationSeconds: 12,
      maxDurationSeconds: 60
    },
    instagram: {
      enabled: boolEnv("INSTAGRAM_UPLOAD_ENABLED", true),
      igUserId: clean(process.env.INSTAGRAM_IG_USER_ID),
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || ""
    },
    meta: {
      appId: clean(process.env.META_APP_ID),
      appSecret: process.env.META_APP_SECRET || "",
      autoRefreshInstagramToken: boolEnv("AUTO_REFRESH_INSTAGRAM_TOKEN", true),
      tokenRefreshBeforeDays: numberEnv("TOKEN_REFRESH_BEFORE_DAYS", 10)
    },
    ftp: remoteConfig()
  };
}

export const config = buildConfig();

export function canPublish() {
  return config.autoPublish && !config.dryRun && config.instagram.enabled;
}

export function shouldUploadToRemote() {
  return ["ftp", "sftp"].includes(config.uploadDriver);
}

export function publicGeneratedUrl(folder, filename) {
  if (!config.publicBaseUrl) return "";
  return `${config.publicBaseUrl}/${folder}/${encodeURIComponent(filename)}`;
}

export function publicVideoUrl(filename) {
  return publicGeneratedUrl("videos", filename);
}

export function publicThumbnailUrl(filename) {
  return publicGeneratedUrl("thumbnails", filename);
}

export function publicMetadataUrl(filename) {
  return publicGeneratedUrl("metadata", filename);
}

