import { FrameExtractor } from "../ffmpeg/frameExtractor.js";
import { MagnificImageProvider } from "../image/magnificImageProvider.js";
import { ImageService } from "../image/imageService.js";
import { JsonSessionStore } from "../session/sessionStore.js";
import { CommandRouter } from "../telegram/commandRouter.js";
import { TelegramClient } from "../telegram/telegramClient.js";
import type { TelegramUpdate } from "../telegram/telegramTypes.js";
import { SftpUploader } from "../uploader/sftpUploader.js";
import { loadEnv, getEnv } from "../utils/env.js";
import { MagnificVideoProvider } from "../video/magnificVideoProvider.js";
import { VideoService } from "../video/videoService.js";

loadEnv();

async function main(): Promise<void> {
  const update = readTelegramUpdate();
  const uploader = SftpUploader.fromEnv();
  const telegram = new TelegramClient(getEnv("TELEGRAM_BOT_TOKEN"));
  const imageProvider = new MagnificImageProvider();
  const videoProvider = new MagnificVideoProvider();

  const router = new CommandRouter({
    store: new JsonSessionStore(process.env.SESSION_DIR || "data/sessions"),
    telegram,
    imageService: new ImageService(imageProvider, uploader, process.env.OUTPUT_DIR || "generated"),
    videoService: new VideoService(videoProvider),
    frameExtractor: new FrameExtractor(process.env.FFMPEG_PATH || "ffmpeg"),
    uploader,
    outputRoot: process.env.OUTPUT_DIR || "generated"
  });

  await router.handleUpdate(update);
}

function readTelegramUpdate(): TelegramUpdate {
  const raw = process.env.TELEGRAM_UPDATE || process.argv[2];
  if (!raw) {
    throw new Error("TELEGRAM_UPDATE env or JSON argument is required");
  }

  return JSON.parse(raw) as TelegramUpdate;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
