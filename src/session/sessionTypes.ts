export type SessionStatus =
  | "new"
  | "waiting_base_upload"
  | "base_uploaded"
  | "frame1_pending"
  | "frame1_ready"
  | "frame2_pending"
  | "frame2_ready"
  | "prompt_ready"
  | "continue_pending"
  | "generating"
  | "completed"
  | "error";

export interface Session {
  userId: string;
  projectId: string;
  baseImageTelegramFileId: string | null;
  baseImageLocalPath: string | null;
  frame1Path: string | null;
  frame2Path: string | null;
  lastEndFramePath: string | null;
  prompt: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;

  frame1Instruction?: string | null;
  frame2Instruction?: string | null;
  frame1BaseImageTelegramFileId?: string | null;
  frame2BaseImageTelegramFileId?: string | null;
  outputVideoPath?: string | null;
  firstFramePath?: string | null;
  lastError?: string | null;
}

export type SessionPatch = Partial<Omit<Session, "userId" | "createdAt">>;
