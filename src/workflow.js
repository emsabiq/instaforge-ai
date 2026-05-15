import path from "node:path";
import { config, canPublish, shouldUploadToRemote } from "./config.js";
import { ensureDirs, appendHistory, saveJson } from "./storage.js";
import { generateVideoPlan } from "./ai.js";
import { renderVideo as renderLocalVideo } from "./renderer.js";
import { renderReplicateVideo } from "./replicate-renderer.js";
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

function normalizeEngine(value) {
  const engine = String(value || config.video.engine || "ffmpeg").trim().toLowerCase();
  return engine === "replicate" ? "replicate" : "ffmpeg";
}

function normalizeAudience(value) {
  const audience = String(value || config.video.audience || "general").trim().toLowerCase();
  return audience === "children" ? "children" : "general";
}

function normalizeAspect(value) {
  const aspect = String(value || config.video.aspectRatio || "9:16").trim().toLowerCase();
  if (["landscape", "wide", "16x9", "16:9"].includes(aspect)) return "16:9";
  if (["square", "1x1", "1:1"].includes(aspect)) return "1:1";
  return "9:16";
}

export async function runWorkflow(options = {}) {
  await ensureDirs();

  const jobId = options.jobId || makeJobId();
  const durationSeconds = normalizeDuration(options.durationSeconds);
  const prompt = String(options.prompt || "").trim();
  const mood = String(options.mood || "clean").trim() || "clean";
  const engine = normalizeEngine(options.engine);
  const audience = normalizeAudience(options.audience);
  const aspectRatio = normalizeAspect(options.aspectRatio || options.aspect_ratio);
  if (!prompt) throw new Error("Prompt video wajib diisi.");

  console.log("JOB:", jobId);
  console.log("PROMPT:", prompt);
  console.log("MOOD:", mood);
  console.log("DURATION:", durationSeconds);
  console.log("ENGINE:", engine);
  console.log("AUDIENCE:", audience);
  console.log("ASPECT:", aspectRatio);
  console.log("PUBLISH REQUESTED:", Boolean(options.publish));

  const plan = await generateVideoPlan({ prompt, mood, durationSeconds, audience });
  console.log("AI TITLE:", plan.title);

  const render = engine === "replicate"
    ? await renderReplicateVideo({ jobId, plan, durationSeconds, aspectRatio })
    : await renderLocalVideo({ jobId, plan, durationSeconds });
  console.log("VIDEO RENDERED:", render.videoPath);

  const metadata = {
    job_id: jobId,
    app: config.appName,
    status: "rendered",
    prompt,
    mood,
    engine,
    audience,
    aspect_ratio: aspectRatio,
    title: plan.title,
    caption: plan.caption,
    character: plan.character,
    scenes: plan.scenes,
    replicate_model: render.model || "",
    replicate_source_url: render.sourceUrl || "",
    replicate_input: render.replicateInput || null,
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
    engine,
    audience,
    aspect_ratio: aspectRatio,
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
