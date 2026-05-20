import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";

export class FrameExtractor {
  constructor(private readonly ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg") {}

  async extractFirstFrame(videoPath: string, outputPath: string): Promise<string> {
    await ensureDir(path.dirname(outputPath));
    await runCommand(this.ffmpegPath, ["-y", "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath]);
    return outputPath;
  }

  async extractLastFrame(videoPath: string, outputPath: string): Promise<string> {
    await ensureDir(path.dirname(outputPath));
    await runCommand(this.ffmpegPath, [
      "-y",
      "-sseof",
      "-1",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath
    ]);
    return outputPath;
  }
}
