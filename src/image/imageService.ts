import path from "node:path";
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

    return {
      image,
      upload,
      storedPath: upload.publicUrl || image.path
    };
  }

  async materializeImage(imagePathOrUrl: string, targetPath: string): Promise<string> {
    await ensureDir(path.dirname(targetPath));

    if (isHttpUrl(imagePathOrUrl)) {
      const extension = extractExtensionFromUrl(imagePathOrUrl);
      const finalTarget = path.extname(targetPath) ? targetPath : `${targetPath}${extension}`;
      return downloadToFile(imagePathOrUrl, finalTarget);
    }

    if (await fileExists(imagePathOrUrl)) {
      return imagePathOrUrl;
    }

    throw new Error(`Image is not available locally or as URL: ${imagePathOrUrl}`);
  }
}
