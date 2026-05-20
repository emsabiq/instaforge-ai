export interface ImageResult {
  path: string;
  url?: string;
  provider: string;
  metadata?: Record<string, unknown>;
}

export interface CreateFrameOptions {
  outputDir?: string;
  outputFileName?: string;
  width?: number;
  height?: number;
  style?: string;
}

export interface EnhanceImageOptions {
  outputDir?: string;
  outputFileName?: string;
  upscale?: number;
}

export interface ImageProvider {
  createFrameFromBase(
    baseImage: string,
    instruction: string,
    options?: CreateFrameOptions
  ): Promise<ImageResult>;

  enhanceImage(image: string, options?: EnhanceImageOptions): Promise<ImageResult>;
}
