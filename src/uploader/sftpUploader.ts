import path from "node:path";
import posixPath from "node:path/posix";
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import { numberEnv, optionalEnv } from "../utils/env.js";

export interface UploadResult {
  success: boolean;
  localPath: string;
  remotePath?: string;
  publicUrl?: string;
  error?: string;
}

interface RemoteConfig {
  host?: string;
  port: number;
  username?: string;
  password?: string;
  remoteDir?: string;
}

interface UploaderConfig {
  sftp: RemoteConfig;
  ftp: RemoteConfig;
  uploadDriver: "auto" | "sftp" | "ftp";
  publicBaseUrl?: string;
}

export class SftpUploader {
  constructor(private readonly config: UploaderConfig) {}

  static fromEnv(): SftpUploader {
    return new SftpUploader({
      sftp: {
        host: optionalEnv("SFTP_HOST"),
        port: numberEnv("SFTP_PORT", 22),
        username: optionalEnv("SFTP_USER"),
        password: optionalEnv("SFTP_PASSWORD"),
        remoteDir: optionalEnv("SFTP_REMOTE_DIR")
      },
      ftp: {
        host: optionalEnv("FTP_HOST"),
        port: numberEnv("FTP_PORT", 21),
        username: optionalEnv("FTP_USER"),
        password: optionalEnv("FTP_PASSWORD"),
        remoteDir: optionalEnv("FTP_REMOTE_DIR")
      },
      uploadDriver: parseUploadDriver(optionalEnv("UPLOAD_DRIVER")),
      publicBaseUrl: optionalEnv("PUBLIC_BASE_URL")
    });
  }

  async uploadFile(localPath: string, remoteRelativePath?: string): Promise<UploadResult> {
    const relativePath = remoteRelativePath || path.basename(localPath);
    const errors: string[] = [];

    if (!this.isConfigured(this.config.sftp) && !this.isConfigured(this.config.ftp)) {
      return {
        success: false,
        localPath,
        error: "SFTP/FTP is not configured"
      };
    }

    if (this.config.uploadDriver !== "ftp" && this.isConfigured(this.config.sftp)) {
      const result = await this.uploadViaSftp(localPath, relativePath);
      if (result.success) {
        return result;
      }
      errors.push(`SFTP: ${result.error || "failed"}`);
    }

    if (this.config.uploadDriver !== "sftp" && this.isConfigured(this.config.ftp)) {
      const result = await this.uploadViaFtp(localPath, relativePath);
      if (result.success) {
        return result;
      }
      errors.push(`FTP: ${result.error || "failed"}`);
      return {
        ...result,
        error: errors.join("; ")
      };
    }

    return {
      success: false,
      localPath,
      error: errors.join("; ") || "SFTP/FTP upload failed"
    };
  }

  private async uploadViaSftp(localPath: string, relativePath: string): Promise<UploadResult> {
    const client = new SftpClient("telegram-ai-frame-uploader");
    const remotePath = this.remotePathFor(this.config.sftp, relativePath);

    try {
      await client.connect({
        host: this.config.sftp.host as string,
        port: this.config.sftp.port,
        username: this.config.sftp.username as string,
        password: this.config.sftp.password,
        readyTimeout: 30000
      });

      await this.ensureSftpRemoteDir(client, posixPath.dirname(remotePath));
      await client.put(localPath, remotePath);

      return {
        success: true,
        localPath,
        remotePath,
        publicUrl: this.publicUrlFor(relativePath)
      };
    } catch (error) {
      return {
        success: false,
        localPath,
        remotePath,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      try {
        await client.end();
      } catch {
        // Ignore disconnect errors after an upload failure.
      }
    }
  }

  private async uploadViaFtp(localPath: string, relativePath: string): Promise<UploadResult> {
    const client = new FtpClient(30000);
    const remotePath = this.remotePathFor(this.config.ftp, relativePath);

    try {
      await client.access({
        host: this.config.ftp.host as string,
        port: this.config.ftp.port,
        user: this.config.ftp.username as string,
        password: this.config.ftp.password,
        secure: false
      });

      await client.ensureDir(posixPath.dirname(remotePath));
      await client.uploadFrom(localPath, posixPath.basename(remotePath));

      return {
        success: true,
        localPath,
        remotePath,
        publicUrl: this.publicUrlFor(relativePath)
      };
    } catch (error) {
      return {
        success: false,
        localPath,
        remotePath,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      client.close();
    }
  }

  private isConfigured(config: RemoteConfig): boolean {
    return Boolean(config.host && config.username && config.remoteDir);
  }

  private remotePathFor(config: RemoteConfig, relativePath: string): string {
    const normalizedRemoteDir = (config.remoteDir || ".").replace(/\\/g, "/");
    const normalizedRelative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return posixPath.join(normalizedRemoteDir, normalizedRelative);
  }

  private publicUrlFor(relativePath: string): string | undefined {
    if (!this.config.publicBaseUrl) {
      return undefined;
    }

    const base = this.config.publicBaseUrl.replace(/\/+$/, "");
    const normalizedRelative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return `${base}/${normalizedRelative}`;
  }

  private async ensureSftpRemoteDir(client: SftpClient, dirPath: string): Promise<void> {
    const normalized = dirPath.replace(/\\/g, "/");
    if (normalized === "." || normalized === "/") {
      return;
    }

    const parts = normalized.split("/").filter(Boolean);
    let current = normalized.startsWith("/") ? "/" : "";

    for (const part of parts) {
      current = current === "/" ? `/${part}` : posixPath.join(current, part);
      try {
        await client.stat(current);
      } catch {
        await client.mkdir(current, false);
      }
    }
  }
}

function parseUploadDriver(value?: string): "auto" | "sftp" | "ftp" {
  if (value === "sftp" || value === "ftp") {
    return value;
  }

  return "auto";
}
