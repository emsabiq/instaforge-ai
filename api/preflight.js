import {
  check,
  clean,
  configSummary,
  methodAllowed,
  remoteMissingEnv,
  requireAuth,
  sendJson
} from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST", "GET"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const remoteMissing = remoteMissingEnv();
    const cfg = configSummary();
    const checks = [
      check("Dashboard PIN", Boolean(clean(process.env.AUTO_DASHBOARD_PIN)), "PIN aktif"),
      check("GitHub repo", Boolean(cfg.githubRepo), cfg.githubRepo),
      check("Workflow token", Boolean(clean(process.env.GH_REPO_SECRET_TOKEN || process.env.GITHUB_TOKEN)), "dibutuhkan untuk tombol run"),
      check("Workflow file", Boolean(cfg.workflowFile), cfg.workflowFile),
      check("PUBLIC_BASE_URL", Boolean(cfg.publicBaseUrl), cfg.publicBaseUrl),
      check("Remote storage", remoteMissing.length === 0, remoteMissing.length ? `missing env: ${remoteMissing.join(", ")}` : cfg.uploadDriver),
      check("OpenAI API", Boolean(clean(process.env.OPENAI_API_KEY)), cfg.openaiModel),
      check("Replicate API", Boolean(clean(process.env.REPLICATE_API_TOKEN)), cfg.replicateModel, false),
      check("Video engine", true, `${cfg.videoEngine} / ${cfg.videoAspectRatio} / ${cfg.videoAudience}`, false),
      check("Instagram ID", Boolean(clean(process.env.INSTAGRAM_IG_USER_ID)), "INSTAGRAM_IG_USER_ID"),
      check("Instagram token", Boolean(clean(process.env.INSTAGRAM_ACCESS_TOKEN)), "INSTAGRAM_ACCESS_TOKEN"),
      check("Meta App Secret", Boolean(clean(process.env.META_APP_ID) && clean(process.env.META_APP_SECRET)), "untuk refresh token", false),
      check("Only Instagram", true, "Facebook/YouTube/TikTok/Threads tidak dipakai di workflow ini", false),
      check("Config", true, JSON.stringify(cfg), false)
    ];

    sendJson(res, 200, { checks });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
