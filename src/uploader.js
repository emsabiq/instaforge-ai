import fs from "node:fs/promises";
import path from "node:path";
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import {
  config,
  publicMetadataUrl,
  publicThumbnailUrl,
  publicVideoUrl,
  shouldUploadToRemote
} from "./config.js";

function requireRemoteConfig() {
  const prefix = config.ftp.envPrefix;
  const missing = [];
  if (!config.ftp.host) missing.push(`${prefix}_HOST`);
  if (!config.ftp.user) missing.push(`${prefix}_USER`);
  if (!config.ftp.password && !config.ftp.privateKey) missing.push(`${prefix}_PASSWORD`);
  if (!config.ftp.remoteDir) missing.push(`${prefix}_REMOTE_DIR`);
  if (missing.length) throw new Error(`${config.ftp.label} config belum lengkap: ${missing.join(", ")}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableRemoteError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");
  const text = `${code} ${message}`;
  if (/\b(530|550|553)\b|auth|authentication|permission denied|login incorrect/i.test(text)) return false;
  return /timeout|timed out|closed|socket|econn|etimedout|econnreset|econnrefused|epipe|connection lost|421|425|426|450|451/i.test(text);
}

class SftpRemoteClient {
  constructor(client) {
    this.client = client;
    this.cwd = "/";
  }

  resolve(remotePath = ".") {
    const target = String(remotePath || ".");
    if (target === ".") return this.cwd;
    return path.posix.isAbsolute(target) ? target : path.posix.join(this.cwd, target);
  }

  async ensureDir(remoteDir) {
    const dir = this.resolve(remoteDir);
    await this.client.mkdir(dir, true);
    this.cwd = dir;
  }

  async uploadFrom(localPath, remoteName) {
    await this.client.put(localPath, this.resolve(remoteName));
  }

  async size(remoteName) {
    const stat = await this.client.stat(this.resolve(remoteName));
    return stat.size || 0;
  }

  async close() {
    await this.client.end();
  }
}

async function connectRemoteClient(timeoutMs) {
  if (config.uploadDriver === "sftp") {
    const client = new SftpClient();
    await client.connect({
      host: config.ftp.host,
      port: config.ftp.port,
      username: config.ftp.user,
      password: config.ftp.password || undefined,
      privateKey: config.ftp.privateKey || undefined,
      passphrase: config.ftp.passphrase || undefined,
      readyTimeout: Math.max(timeoutMs || config.ftp.timeoutMs, 5000),
      keepaliveInterval: 10000,
      keepaliveCountMax: 12
    });
    return new SftpRemoteClient(client);
  }

  const client = new FtpClient(timeoutMs || config.ftp.timeoutMs);
  await client.access({
    host: config.ftp.host,
    port: config.ftp.port,
    user: config.ftp.user,
    password: config.ftp.password,
    secure: false
  });
  return client;
}

async function closeRemoteClient(client) {
  if (!client) return;
  if (typeof client.close !== "function") return;
  try {
    await client.close();
  } catch {
    // Keep the original remote error visible.
  }
}

export async function withRemoteClient(callback, options = {}) {
  requireRemoteConfig();
  const maxAttempts = Math.max(1, Number(options.retries || config.ftp.retries || 3));
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let client = null;
    try {
      client = await connectRemoteClient(options.timeoutMs || config.ftp.timeoutMs);
      return await callback(client, attempt);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && isRetriableRemoteError(error);
      if (!canRetry) throw error;
      console.warn(`${config.ftp.label} attempt ${attempt}/${maxAttempts} gagal, retry: ${error.message}`);
      await sleep(Math.min(45000, 5000 * attempt));
    } finally {
      await closeRemoteClient(client);
    }
  }

  throw lastError;
}

async function uploadVerified(client, localPath, remoteName) {
  const expectedSize = (await fs.stat(localPath)).size;
  try {
    if (await client.size(remoteName) === expectedSize) return;
  } catch {
    // File belum ada.
  }
  await client.uploadFrom(localPath, remoteName);
}

export async function uploadFiles({ jobId, videoPath, thumbnailPath, metadataPath }) {
  const videoName = `${jobId}.mp4`;
  const thumbnailName = `${jobId}.jpg`;
  const metadataName = `${jobId}.json`;

  if (!shouldUploadToRemote()) {
    return {
      videoUrl: "",
      thumbnailUrl: "",
      metadataUrl: "",
      videoName,
      thumbnailName,
      metadataName
    };
  }

  await withRemoteClient(async (client) => {
    await client.ensureDir(path.posix.join(config.ftp.remoteDir, "videos"));
    await uploadVerified(client, videoPath, videoName);
    await client.ensureDir(path.posix.join(config.ftp.remoteDir, "thumbnails"));
    await uploadVerified(client, thumbnailPath, thumbnailName);
    await client.ensureDir(path.posix.join(config.ftp.remoteDir, "metadata"));
    await uploadVerified(client, metadataPath, metadataName);
  }, { timeoutMs: config.ftp.uploadTimeoutMs, retries: config.ftp.retries });

  return {
    videoUrl: publicVideoUrl(videoName),
    thumbnailUrl: publicThumbnailUrl(thumbnailName),
    metadataUrl: publicMetadataUrl(metadataName),
    videoName,
    thumbnailName,
    metadataName
  };
}

export async function validatePublicUrl(url) {
  if (!url) return false;

  for (let attempt = 1; attempt <= config.ftp.publicUrlRetries; attempt += 1) {
    try {
      const cacheBustUrl = `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
      let response = await fetch(cacheBustUrl, { method: "HEAD", cache: "no-store" });
      if (response.ok) return true;
      response = await fetch(cacheBustUrl, {
        method: "GET",
        cache: "no-store",
        headers: { Range: "bytes=0-2047" }
      });
      if (response.ok || response.status === 206) return true;
    } catch {
      // Public hosting can lag after upload.
    }
    if (attempt < config.ftp.publicUrlRetries) await sleep(config.ftp.publicUrlRetryDelayMs);
  }

  return false;
}
