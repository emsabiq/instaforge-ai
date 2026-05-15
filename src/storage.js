import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export async function ensureDirs() {
  await Promise.all([
    config.dataDir,
    config.generatedDir,
    config.videoDir,
    config.thumbnailDir,
    config.metadataDir,
    config.tmpDir
  ].map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function saveJson(dir, filename, data) {
  const folder = path.isAbsolute(dir) ? dir : path.join(config.generatedDir, dir);
  await fs.mkdir(folder, { recursive: true });
  const filePath = path.join(folder, filename);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

export async function appendHistory(entry) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const filePath = path.join(config.dataDir, "history.json");
  let history = [];
  try {
    history = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    history = [];
  }
  history.push(entry);
  await fs.writeFile(filePath, `${JSON.stringify(history.slice(-100), null, 2)}\n`, "utf8");
  return filePath;
}

export async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

