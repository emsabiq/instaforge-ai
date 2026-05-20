import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureDir } from "./fs.js";

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export async function downloadToFile(url: string, targetPath: string): Promise<string> {
  await ensureDir(path.dirname(targetPath));

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(targetPath));
  return targetPath;
}

export function extractExtensionFromUrl(url: string, fallback = ".jpg"): string {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname);
    return ext || fallback;
  } catch {
    return fallback;
  }
}
