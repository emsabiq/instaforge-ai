import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { ensureDir, fileExists } from "../utils/fs.js";
import { downloadToFile, extractExtensionFromUrl, isHttpUrl } from "../utils/http.js";
import type { SftpUploader, UploadResult } from "../uploader/sftpUploader.js";
import type { ImageProvider, ImageResult } from "./imageProvider.js";

export interface CreateFrameRequest {
  baseImage: string;
  instruction: string;
  projectId: string;
  frameName: "frame1" | "frame2";
}

export interface CreateFrameResponse {
  image: ImageResult;
  upload: UploadResult;
  storedPath: string;
}

const minimumImageBytes = 1024;

export class ImageService {
  constructor(
    private readonly provider: ImageProvider,
    private readonly uploader?: SftpUploader,
    private readonly outputRoot = process.env.OUTPUT_DIR || "generated"
  ) {}

  async createFrameFromBase(request: CreateFrameRequest): Promise<CreateFrameResponse> {
    const outputDir = path.join(this.outputRoot, request.projectId, "images");
    const image = await this.provider.createFrameFromBase(request.baseImage, request.instruction, {
      outputDir,
      outputFileName: `${request.frameName}.jpg`
    });

    const upload = this.uploader
      ? await this.uploader.uploadFile(image.path, `${request.projectId}/${request.frameName}.jpg`)
      : {
          success: false,
          localPath: image.path,
          error: "SFTP uploader is not configured"
        };
    const storedPath = await this.pickStoredPath(image, upload);

    return {
      image,
      upload,
      storedPath
    };
  }

  async materializeImage(imagePathOrUrl: string, targetPath: string): Promise<string> {
    await ensureDir(path.dirname(targetPath));

    if (isHttpUrl(imagePathOrUrl)) {
      const extension = extractExtensionFromUrl(imagePathOrUrl);
      const finalTarget = path.extname(targetPath) ? targetPath : `${targetPath}${extension}`;
      await downloadToFile(imagePathOrUrl, finalTarget);
      if (await this.isValidImageFile(finalTarget)) {
        return finalTarget;
      }

      await this.removeInvalidFile(finalTarget);
      throw new Error(`Downloaded image is invalid or incomplete: ${imagePathOrUrl}`);
    }

    if ((await fileExists(imagePathOrUrl)) && (await this.isValidImageFile(imagePathOrUrl))) {
      return imagePathOrUrl;
    }

    throw new Error(`Image is not available locally or as URL: ${imagePathOrUrl}`);
  }

  private async pickStoredPath(image: ImageResult, upload: UploadResult): Promise<string> {
    if (upload.publicUrl && (await this.isReachable(upload.publicUrl))) {
      return upload.publicUrl;
    }

    if (image.url) {
      return image.url;
    }

    return upload.publicUrl || image.path;
  }

  private async isReachable(url: string): Promise<boolean> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return false;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return this.isValidImageBuffer(buffer);
    } catch {
      return false;
    }
  }

  private async isValidImageFile(filePath: string): Promise<boolean> {
    try {
      const buffer = await readFile(filePath);
      return this.isValidImageBuffer(buffer);
    } catch {
      return false;
    }
  }

  private isValidImageBuffer(buffer: Buffer): boolean {
    if (buffer.length < minimumImageBytes) {
      return false;
    }

    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    const isWebp = buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";

    return isJpeg || isPng || isWebp;
  }

  private async removeInvalidFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // Ignore cleanup errors; the caller already receives the validation failure.
    }
  }
}
