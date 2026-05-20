import path from "node:path";
import { ensureDir, readJsonFile, safeFileName, writeJsonFile } from "../utils/fs.js";
import type { Session, SessionPatch } from "./sessionTypes.js";

export interface SessionStore {
  createSession(userId: string): Promise<Session>;
  getSession(userId: string): Promise<Session | null>;
  updateSession(userId: string, patch: SessionPatch): Promise<Session>;
  resetSession(userId: string): Promise<Session>;
}

export class JsonSessionStore implements SessionStore {
  constructor(private readonly sessionDir = process.env.SESSION_DIR || "data/sessions") {}

  async createSession(userId: string): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      userId,
      projectId: `tg-${safeFileName(userId)}-${Date.now()}`,
      baseImageTelegramFileId: null,
      baseImageLocalPath: null,
      frame1Path: null,
      frame2Path: null,
      lastEndFramePath: null,
      prompt: null,
      status: "new",
      createdAt: now,
      updatedAt: now,
      frame1Instruction: null,
      frame2Instruction: null,
      frame1BaseImageTelegramFileId: null,
      frame2BaseImageTelegramFileId: null,
      outputVideoPath: null,
      firstFramePath: null,
      lastError: null
    };

    await this.writeSession(session);
    return session;
  }

  async getSession(userId: string): Promise<Session | null> {
    return readJsonFile<Session>(this.fileForUser(userId));
  }

  async getOrCreateSession(userId: string): Promise<Session> {
    return (await this.getSession(userId)) || this.createSession(userId);
  }

  async updateSession(userId: string, patch: SessionPatch): Promise<Session> {
    const current = await this.getOrCreateSession(userId);
    const updated: Session = {
      ...current,
      ...patch,
      userId: current.userId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    };

    await this.writeSession(updated);
    return updated;
  }

  async resetSession(userId: string): Promise<Session> {
    return this.createSession(userId);
  }

  private fileForUser(userId: string): string {
    return path.join(this.sessionDir, `${safeFileName(userId)}.json`);
  }

  private async writeSession(session: Session): Promise<void> {
    await ensureDir(this.sessionDir);
    await writeJsonFile(this.fileForUser(session.userId), session);
  }
}
