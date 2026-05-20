import path from "node:path";
import { FrameExtractor } from "../ffmpeg/frameExtractor.js";
import { ImageService } from "../image/imageService.js";
import type { Session } from "../session/sessionTypes.js";
import { JsonSessionStore } from "../session/sessionStore.js";
import { SftpUploader } from "../uploader/sftpUploader.js";
import { describeHttpError } from "../utils/errors.js";
import { ensureDir, safeFileName } from "../utils/fs.js";
import { isHttpUrl } from "../utils/http.js";
import { VideoService } from "../video/videoService.js";
import { TelegramClient } from "./telegramClient.js";
import type { TelegramMessage, TelegramPhotoSize, TelegramUpdate } from "./telegramTypes.js";

interface CommandRouterDeps {
  store: JsonSessionStore;
  telegram: TelegramClient;
  imageService: ImageService;
  videoService: VideoService;
  frameExtractor: FrameExtractor;
  uploader: SftpUploader;
  outputRoot?: string;
}

type FrameName = "frame1" | "frame2";

export class CommandRouter {
  private readonly outputRoot: string;

  constructor(private readonly deps: CommandRouterDeps) {
    this.outputRoot = deps.outputRoot || process.env.OUTPUT_DIR || "generated";
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message || update.edited_message;
    if (!message) {
      return;
    }

    const chatId = message.chat.id;
    const userId = this.userIdFor(message);

    try {
      if (message.photo?.length) {
        await this.handlePhoto(userId, chatId, message.photo);
        return;
      }

      const text = (message.text || message.caption || "").trim();
      if (!text) {
        await this.deps.telegram.sendMessage(chatId, this.helpText());
        return;
      }

      const commandEnd = text.indexOf(" ") === -1 ? text.length : text.indexOf(" ");
      const command = text.slice(0, commandEnd).toLowerCase().split("@")[0];
      const args = text.slice(commandEnd).trim();

      switch (command) {
        case "/new":
          await this.handleNew(userId, chatId);
          break;
        case "/upload":
          await this.handleUpload(userId, chatId);
          break;
        case "/frame1":
          await this.handleFrameCommand(userId, chatId, "frame1", args);
          break;
        case "/frame2":
          await this.handleFrameCommand(userId, chatId, "frame2", args);
          break;
        case "/prompt":
          await this.handlePrompt(userId, chatId, args);
          break;
        case "/generate":
          await this.handleGenerate(userId, chatId);
          break;
        case "/continue":
          await this.handleContinue(userId, chatId);
          break;
        case "/use_last_frame1":
          await this.handleUseLastFrame1(userId, chatId);
          break;
        case "/new_frame1":
          await this.handleNewFrame(userId, chatId, "frame1");
          break;
        case "/new_frame2":
          await this.handleNewFrame(userId, chatId, "frame2");
          break;
        case "/replace_frame1":
          await this.handleReplaceFrame(userId, chatId, "frame1", args);
          break;
        case "/replace_frame2":
          await this.handleReplaceFrame(userId, chatId, "frame2", args);
          break;
        case "/status":
          await this.handleStatus(userId, chatId);
          break;
        case "/reset":
          await this.handleReset(userId, chatId);
          break;
        default:
          await this.deps.telegram.sendMessage(chatId, this.helpText());
      }
    } catch (error) {
      const messageText = describeHttpError(error);
      await this.deps.store.updateSession(userId, {
        status: "error",
        lastError: messageText
      });
      await this.deps.telegram.sendMessage(chatId, `Gagal memproses command: ${messageText}`);
    }
  }

  private async handleNew(userId: string, chatId: number): Promise<void> {
    const session = await this.deps.store.createSession(userId);
    await this.deps.telegram.sendMessage(
      chatId,
      [
        `Project baru dibuat: ${session.projectId}`,
        "Kirim foto base sekarang, atau pakai /upload lalu kirim foto.",
        "Setelah itu gunakan /frame1 <instruksi>, /frame2 <instruksi>, /prompt <gerakan>, lalu /generate."
      ].join("\n")
    );
  }

  private async handleUpload(userId: string, chatId: number): Promise<void> {
    await this.deps.store.updateSession(userId, { status: "waiting_base_upload" });
    await this.deps.telegram.sendMessage(chatId, "Kirim foto base sebagai pesan berikutnya.");
  }

  private async handlePhoto(userId: string, chatId: number, photos: TelegramPhotoSize[]): Promise<void> {
    const session = await this.deps.store.getOrCreateSession(userId);
    const largest = [...photos].sort((a, b) => (b.file_size || b.width * b.height) - (a.file_size || a.width * a.height))[0];

    await this.deps.store.updateSession(userId, {
      baseImageTelegramFileId: largest.file_id,
      baseImageLocalPath: null,
      frame1Path: null,
      frame2Path: null,
      frame1Instruction: null,
      frame2Instruction: null,
      status: "base_uploaded",
      lastError: null
    });

    await this.deps.telegram.sendMessage(
      chatId,
      [
        `Foto base tersimpan untuk project ${session.projectId}.`,
        "Lanjut: /frame1 <instruksi frame awal>."
      ].join("\n")
    );
  }

  private async handleFrameCommand(
    userId: string,
    chatId: number,
    frameName: FrameName,
    instruction: string
  ): Promise<void> {
    if (!instruction) {
      await this.deps.telegram.sendMessage(chatId, `Tambahkan instruksi, contoh: /${frameName} latar hutan realistis cinematic`);
      return;
    }

    const session = await this.deps.store.getOrCreateSession(userId);
    if (!session.baseImageTelegramFileId) {
      await this.deps.telegram.sendMessage(
        chatId,
        `Belum ada foto base. Upload foto dulu, lalu ulangi /${frameName} <instruksi>.`
      );
      return;
    }

    await this.deps.store.updateSession(userId, {
      [`${frameName}Instruction`]: instruction,
      [`${frameName}Path`]: null,
      status: frameName === "frame1" ? "frame1_pending" : "frame2_pending",
      lastError: null
    });

    await this.deps.telegram.sendMessage(chatId, `Membuat ${frameName} lewat Magnific image pipeline...`);

    try {
      const localFrame = await this.generateAndStoreFrame(userId, chatId, frameName, instruction);
      await this.deps.telegram.sendPhoto(chatId, localFrame, `${frameName} siap.`);
    } catch (error) {
      const message = describeHttpError(error);
      await this.deps.store.updateSession(userId, { status: "error", lastError: message });
      await this.deps.telegram.sendMessage(
        chatId,
        `Instruksi ${frameName} sudah disimpan, tapi generate image gagal: ${message}`
      );
    }
  }

  private async handlePrompt(userId: string, chatId: number, prompt: string): Promise<void> {
    if (!prompt) {
      await this.deps.telegram.sendMessage(chatId, "Tambahkan prompt gerakan, contoh: /prompt kamera tracking shot pelan durasi 8 detik");
      return;
    }

    await this.deps.store.updateSession(userId, {
      prompt,
      status: "prompt_ready",
      lastError: null
    });
    await this.deps.telegram.sendMessage(chatId, "Prompt video tersimpan. Jalankan /generate saat frame1 dan frame2 siap.");
  }

  private async handleGenerate(userId: string, chatId: number): Promise<void> {
    let session = await this.deps.store.getOrCreateSession(userId);
    if (!session.prompt) {
      await this.deps.telegram.sendMessage(chatId, "Prompt video belum ada. Kirim /prompt <instruksi gerakan> dulu.");
      return;
    }

    await this.deps.store.updateSession(userId, { status: "generating", lastError: null });
    await this.deps.telegram.sendMessage(chatId, "Generate video 8 detik dimulai. Ini akan berjalan di GitHub Actions.");

    const frame1 = await this.ensureFrameLocal(userId, chatId, "frame1");
    const frame2 = await this.ensureFrameLocal(userId, chatId, "frame2");
    session = await this.deps.store.getOrCreateSession(userId);
    const prompt = session.prompt;
    if (!prompt) {
      throw new Error("Prompt video belum tersedia");
    }

    const videoDir = path.join(this.outputRoot, session.projectId, "video");
    const video = await this.deps.videoService.generateVideo({
      frame1: session.frame1Path && isHttpUrl(session.frame1Path) ? session.frame1Path : frame1,
      frame2: session.frame2Path && isHttpUrl(session.frame2Path) ? session.frame2Path : frame2,
      prompt,
      durationSeconds: 8,
      outputDir: videoDir,
      projectId: session.projectId
    });

    const firstFramePath = path.join(videoDir, "first-frame.jpg");
    const lastFramePath = path.join(videoDir, "last-frame.jpg");
    await this.deps.frameExtractor.extractFirstFrame(video.path, firstFramePath);
    await this.deps.frameExtractor.extractLastFrame(video.path, lastFramePath);

    const videoUpload = await this.deps.uploader.uploadFile(video.path, `${session.projectId}/video.mp4`);
    const firstUpload = await this.deps.uploader.uploadFile(firstFramePath, `${session.projectId}/first-frame.jpg`);
    const lastUpload = await this.deps.uploader.uploadFile(lastFramePath, `${session.projectId}/last-frame.jpg`);

    const videoToSend = videoUpload.publicUrl || video.path;
    const lastFrameToSend = lastUpload.publicUrl || lastFramePath;
    await this.deps.telegram.sendVideo(chatId, videoToSend, "Video selesai.");
    await this.deps.telegram.sendPhoto(chatId, lastFrameToSend, "Frame akhir otomatis disimpan untuk part berikutnya.");

    const failedUploads = [videoUpload, firstUpload, lastUpload].filter((item) => !item.success);
    if (failedUploads.length > 0) {
      await this.deps.telegram.sendMessage(
        chatId,
        `Catatan: upload SFTP gagal untuk ${failedUploads.length} file. Output lokal tetap disimpan sebagai artifact GitHub Actions.`
      );
    }

    await this.deps.store.updateSession(userId, {
      outputVideoPath: videoUpload.publicUrl || video.path,
      firstFramePath: firstUpload.publicUrl || firstFramePath,
      lastEndFramePath: lastUpload.publicUrl || lastFramePath,
      status: "completed",
      lastError: null
    });

    await this.deps.telegram.sendMessage(
      chatId,
      ["Pilihan berikutnya:", "/continue", "/use_last_frame1", "/new_frame1"].join("\n")
    );
  }

  private async handleContinue(userId: string, chatId: number): Promise<void> {
    const session = await this.deps.store.getOrCreateSession(userId);
    if (!session.lastEndFramePath) {
      await this.deps.telegram.sendMessage(chatId, "Belum ada frame akhir. Jalankan /generate dulu.");
      return;
    }

    await this.deps.store.updateSession(userId, { status: "continue_pending" });
    await this.deps.telegram.sendMessage(
      chatId,
      ["Lanjutkan part berikutnya dengan pilihan:", "/use_last_frame1", "/new_frame1"].join("\n")
    );
  }

  private async handleUseLastFrame1(userId: string, chatId: number): Promise<void> {
    const session = await this.deps.store.getOrCreateSession(userId);
    if (!session.lastEndFramePath) {
      await this.deps.telegram.sendMessage(chatId, "Belum ada frame akhir untuk dipakai sebagai frame1.");
      return;
    }

    await this.deps.store.updateSession(userId, {
      frame1Path: session.lastEndFramePath,
      frame1Instruction: "previous last frame",
      frame2Path: null,
      frame2Instruction: null,
      prompt: null,
      status: "frame1_ready",
      lastError: null
    });
    await this.deps.telegram.sendMessage(chatId, "Frame akhir sebelumnya sekarang menjadi frame1. Lanjut buat /frame2 dan /prompt baru.");
  }

  private async handleNewFrame(userId: string, chatId: number, frameName: FrameName): Promise<void> {
    await this.deps.store.updateSession(userId, {
      [`${frameName}Path`]: null,
      [`${frameName}Instruction`]: null,
      status: frameName === "frame1" ? "frame1_pending" : "frame2_pending"
    });
    await this.deps.telegram.sendMessage(chatId, `Kirim /${frameName} <instruksi baru>.`);
  }

  private async handleReplaceFrame(
    userId: string,
    chatId: number,
    frameName: FrameName,
    instruction: string
  ): Promise<void> {
    if (instruction) {
      await this.handleFrameCommand(userId, chatId, frameName, instruction);
      return;
    }

    await this.handleNewFrame(userId, chatId, frameName);
  }

  private async handleStatus(userId: string, chatId: number): Promise<void> {
    const session = await this.deps.store.getOrCreateSession(userId);
    await this.deps.telegram.sendMessage(chatId, this.statusText(session));
  }

  private async handleReset(userId: string, chatId: number): Promise<void> {
    const session = await this.deps.store.resetSession(userId);
    await this.deps.telegram.sendMessage(chatId, `Session direset. Project baru: ${session.projectId}`);
  }

  private async ensureFrameLocal(userId: string, chatId: number, frameName: FrameName): Promise<string> {
    const session = await this.deps.store.getOrCreateSession(userId);
    const framePath = frameName === "frame1" ? session.frame1Path : session.frame2Path;
    const instruction = frameName === "frame1" ? session.frame1Instruction : session.frame2Instruction;

    if (framePath) {
      try {
        return await this.materializeFrame(session, frameName, framePath);
      } catch {
        if (!instruction || instruction === "previous last frame") {
          throw new Error(`${frameName} tidak bisa diakses. Buat ulang dengan /${frameName} <instruksi>.`);
        }
      }
    }

    if (!instruction || instruction === "previous last frame") {
      throw new Error(`${frameName} belum siap. Buat dulu dengan /${frameName} <instruksi>.`);
    }

    await this.deps.telegram.sendMessage(chatId, `${frameName} belum ada file final, generate ulang dari instruksi tersimpan...`);
    return this.generateAndStoreFrame(userId, chatId, frameName, instruction);
  }

  private async generateAndStoreFrame(
    userId: string,
    chatId: number,
    frameName: FrameName,
    instruction: string
  ): Promise<string> {
    const session = await this.deps.store.getOrCreateSession(userId);
    const baseImage = await this.ensureBaseImageForProvider(userId, session);
    const response = await this.deps.imageService.createFrameFromBase({
      baseImage,
      instruction,
      projectId: session.projectId,
      frameName
    });

    await this.deps.store.updateSession(userId, {
      [`${frameName}Path`]: response.storedPath,
      status: frameName === "frame1" ? "frame1_ready" : "frame2_ready",
      lastError: response.upload.success ? null : response.upload.error || "SFTP upload failed"
    });

    if (!response.upload.success) {
      await this.deps.telegram.sendMessage(
        chatId,
        `Catatan: ${frameName} berhasil dibuat, tapi upload SFTP gagal. File lokal tetap ada di artifact Actions.`
      );
    }

    return response.image.path;
  }

  private async ensureBaseImageForProvider(userId: string, session: Session): Promise<string> {
    const localPath = await this.ensureBaseImageLocal(userId, session);
    const upload = await this.deps.uploader.uploadFile(localPath, `${session.projectId}/base.jpg`);

    if (upload.publicUrl && (await this.isReachable(upload.publicUrl))) {
      await this.deps.store.updateSession(userId, { baseImageLocalPath: upload.publicUrl });
      return upload.publicUrl;
    }

    const telegramUrl = await this.deps.telegram.getFileUrl(session.baseImageTelegramFileId as string);
    return telegramUrl;
  }

  private async ensureBaseImageLocal(userId: string, session: Session): Promise<string> {
    if (!session.baseImageTelegramFileId) {
      throw new Error("Foto base belum tersedia");
    }

    const projectDir = path.join(this.outputRoot, session.projectId, "inputs");
    await ensureDir(projectDir);
    const targetPath = path.join(projectDir, "base.jpg");
    await this.deps.telegram.downloadFile(session.baseImageTelegramFileId, targetPath);
    await this.deps.store.updateSession(userId, { baseImageLocalPath: targetPath });
    return targetPath;
  }

  private async materializeFrame(session: Session, frameName: FrameName, framePath: string): Promise<string> {
    if (!isHttpUrl(framePath)) {
      return this.deps.imageService.materializeImage(framePath, framePath);
    }

    const targetPath = path.join(this.outputRoot, session.projectId, "inputs", `${frameName}.jpg`);
    return this.deps.imageService.materializeImage(framePath, targetPath);
  }

  private statusText(session: Session): string {
    const yes = "yes";
    const no = "no";
    return [
      `Project: ${session.projectId}`,
      `Status: ${session.status}`,
      `Base image: ${session.baseImageTelegramFileId ? yes : no}`,
      `Frame1: ${session.frame1Path ? yes : session.frame1Instruction ? "instruction saved" : no}`,
      `Frame2: ${session.frame2Path ? yes : session.frame2Instruction ? "instruction saved" : no}`,
      `Prompt: ${session.prompt ? yes : no}`,
      `Last end frame: ${session.lastEndFramePath ? yes : no}`,
      session.lastError ? `Last error: ${session.lastError}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  private helpText(): string {
    return [
      "Command:",
      "/new",
      "/upload",
      "/frame1 <instruksi>",
      "/frame2 <instruksi>",
      "/prompt <instruksi gerakan>",
      "/generate",
      "/continue",
      "/use_last_frame1",
      "/new_frame1",
      "/new_frame2",
      "/replace_frame1",
      "/replace_frame2",
      "/status",
      "/reset"
    ].join("\n");
  }

  private userIdFor(message: TelegramMessage): string {
    return safeFileName(String(message.from?.id || message.chat.id));
  }

  private async isReachable(url: string): Promise<boolean> {
    try {
      let response = await fetch(url, { method: "HEAD" });
      if (response.status === 405) {
        response = await fetch(url, { method: "GET" });
      }
      return response.ok;
    } catch {
      return false;
    }
  }
}
