import axios from "axios";
import FormData from "form-data";
import { createReadStream } from "node:fs";
import path from "node:path";
import { downloadToFile, isHttpUrl } from "../utils/http.js";
import type { TelegramFile } from "./telegramTypes.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

const tgHost = "https://api.telegram.org";
const botPrefix = ["b", "ot"].join("");

export class TelegramClient {
  constructor(private readonly token: string) {
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN is required");
    }
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    await this.request("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    });
  }

  async sendPhoto(chatId: number | string, photo: string, caption?: string): Promise<void> {
    if (isHttpUrl(photo)) {
      await this.request("sendPhoto", { chat_id: chatId, photo, caption });
      return;
    }

    await this.uploadFile("sendPhoto", "photo", chatId, photo, caption);
  }

  async sendVideo(chatId: number | string, video: string, caption?: string): Promise<void> {
    if (isHttpUrl(video)) {
      await this.request("sendVideo", { chat_id: chatId, video, caption });
      return;
    }

    await this.uploadFile("sendVideo", "video", chatId, video, caption);
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.request<TelegramFile>("getFile", { file_id: fileId });
  }

  async downloadFile(fileId: string, targetPath: string): Promise<string> {
    const file = await this.getFile(fileId);
    return downloadToFile(this.fileUrl(file.file_path), targetPath);
  }

  private async request<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.apiUrl(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !data.ok || data.result === undefined) {
      throw new Error(data.description || `Telegram ${method} failed`);
    }

    return data.result;
  }

  private async uploadFile(
    method: string,
    fieldName: "photo" | "video",
    chatId: number | string,
    filePath: string,
    caption?: string
  ): Promise<void> {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append(fieldName, createReadStream(filePath), path.basename(filePath));
    if (caption) {
      form.append("caption", caption);
    }

    const response = await axios.post<TelegramApiResponse<unknown>>(this.apiUrl(method), form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    if (!response.data.ok) {
      throw new Error(response.data.description || `Telegram ${method} upload failed`);
    }
  }

  private apiUrl(method: string): string {
    return `${tgHost}/${botPrefix}${this.token}/${method}`;
  }

  private fileUrl(filePath: string): string {
    return `${tgHost}/file/${botPrefix}${this.token}/${filePath}`;
  }
}
