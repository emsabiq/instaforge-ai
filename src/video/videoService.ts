import type { VideoInput, VideoProvider, VideoResult } from "./videoProvider.js";

export class VideoService {
  constructor(private readonly provider: VideoProvider) {}

  async generateVideo(input: VideoInput): Promise<VideoResult> {
    return this.provider.generateVideo(input);
  }
}
