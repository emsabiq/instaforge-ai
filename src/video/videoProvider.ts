export interface VideoInput {
  frame1: string;
  frame2: string;
  prompt: string;
  durationSeconds: number;
  outputDir: string;
  projectId: string;
}

export interface VideoResult {
  path: string;
  url?: string;
  provider: string;
  metadata?: Record<string, unknown>;
}

export interface VideoProvider {
  generateVideo(input: VideoInput): Promise<VideoResult>;
}
