import path from "node:path";
import { config, canPublish, shouldUploadToRemote } from "./config.js";
import { ensureDirs, appendHistory, saveJson } from "./storage.js";
import { generateVideoPlan } from "./ai.js";
import { renderVideo } from "./renderer.js";
import { uploadFiles, validatePublicUrl } from "./uploader.js";
import { publishReel } from "./instagram.js";

function makeJobId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 6);
  return `igai_${stamp}_${random}`;
}

function normalizeDuration(value) {
  const duration = Number(value || 24);
  if (!Number.isFinite(duration)) return 24;
  return Math.max(config.video.minDurationSeconds, Math.min(config.video.maxDurationSeconds, Math.round(duration)));
}

function stripSourceCredit(caption) {
  return String(caption || "")
    .replace(/\s*(?:source|sumber)\s*:\s*https?:\/\/\S+/gi, "")
    .trim();
}

export async function runWorkflow(options = {}) {
  await ensureDirs();

  const jobId = options.jobId || makeJobId();
  const durationSeconds = normalizeDuration(options.durationSeconds);
  const prompt = String(options.prompt || "").trim();
  const mood = String(options.mood || "clean").trim() || "clean";
  if (!prompt) throw new Error("Prompt video wajib diisi.");

  console.log("JOB:", jobId);
  console.log("PROMPT:", prompt);
  console.log("MOOD:", mood);
  console.log("DURATION:", durationSeconds);
  console.log("PUBLISH REQUESTED:", Boolean(options.publish));

  const plan = await generateVideoPlan({ prompt, mood, durationSeconds });
  console.log("AI TITLE:", plan.title);

  const render = await renderVideo({ jobId, plan, durationSeconds });
  console.log("VIDEO RENDERED:", render.videoPath);

  const metadata = {
    job_id: jobId,
    app: config.appName,
    status: "rendered",
    prompt,
    mood,
    title: plan.title,
    caption: plan.caption,
    scenes: plan.scenes,
    video_path: render.videoPath,
    thumbnail_path: render.thumbnailPath,
    duration_seconds: render.durationSeconds,
    width: render.width,
    height: render.height,
    created_at: new Date().toISOString()
  };
  const metadataPath = await saveJson("metadata", `${jobId}.json`, metadata);

  let upload = {
    videoUrl: "",
    thumbnailUrl: "",
    metadataUrl: ""
  };

  if (shouldUploadToRemote()) {
    upload = await uploadFiles({
      jobId,
      videoPath: render.videoPath,
      thumbnailPath: render.thumbnailPath,
      metadataPath
    });
    const ok = await validatePublicUrl(upload.videoUrl);
    if (!ok) throw new Error(`Public video URL belum valid: ${upload.videoUrl}`);
    console.log("PUBLIC VIDEO URL:", upload.videoUrl);
  } else if (config.remoteUploadRequired) {
    throw new Error("REMOTE_UPLOAD_REQUIRED=true tetapi UPLOAD_DRIVER bukan ftp/sftp.");
  }

  let instagram = null;
  const publishEnabled = Boolean(options.publish) && canPublish();

  if (publishEnabled) {
    instagram = await publishReel({
      videoUrl: upload.videoUrl,
      caption: stripSourceCredit(plan.caption),
      coverUrl: upload.thumbnailUrl
    });
  }

  const status = instagram ? "published" : options.publish ? "dry_run_or_disabled" : "ready";
  const result = {
    status,
    job_id: jobId,
    title: plan.title,
    caption: plan.caption,
    video_path: path.relative(config.rootDir, render.videoPath),
    thumbnail_path: path.relative(config.rootDir, render.thumbnailPath),
    metadata_path: path.relative(config.rootDir, metadataPath),
    public_video_url: upload.videoUrl,
    public_thumbnail_url: upload.thumbnailUrl,
    public_metadata_url: upload.metadataUrl,
    instagram_media_id: instagram?.mediaId || "",
    instagram_container_id: instagram?.containerId || "",
    published_at: instagram ? new Date().toISOString() : ""
  };

  await saveJson("metadata", `${jobId}-result.json`, result);
  await appendHistory({
    ...result,
    prompt,
    mood,
    created_at: metadata.created_at
  });

  console.log("RESULT:", JSON.stringify(result, null, 2));
  return result;
}

