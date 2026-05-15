import {
  configSummary,
  getRecentRuns,
  getRunJobs,
  methodAllowed,
  requireAuth,
  sendJson
} from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const recentRuns = await getRecentRuns();
    const latestRun = recentRuns[0] || null;
    const liveJobs = latestRun && ["in_progress", "queued"].includes(latestRun.status)
      ? await getRunJobs(latestRun.id)
      : [];

    sendJson(res, 200, {
      config: configSummary(),
      activeRun: latestRun ? buildActiveRun(latestRun, liveJobs) : null,
      recentRuns
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

function buildActiveRun(run, liveJobs) {
  const allSteps = liveJobs.flatMap((job) =>
    (job.steps || []).map((step) => ({ ...step, jobName: job.name }))
  );
  const total = allSteps.length;
  const completed = allSteps.filter((step) => step.status === "completed").length;
  const inProgress = allSteps.find((step) => step.status === "in_progress") || null;
  const progress = total ? Math.round((completed / total) * 100) : null;
  const status = ["in_progress", "queued"].includes(run.status) ? "running" : run.conclusion || run.status;

  return {
    id: String(run.id),
    name: run.name || "Instagram AI Video",
    title: run.display_title || "",
    branch: run.head_branch || "",
    status,
    conclusion: run.conclusion || "",
    startedAt: run.created_at,
    finishedAt: run.status === "completed" ? run.updated_at : "",
    htmlUrl: run.html_url,
    progress,
    detail: inProgress
      ? `Sedang: ${inProgress.jobName} -> ${inProgress.name}`
      : run.display_title || run.html_url,
    jobs: liveJobs,
    error: run.conclusion === "failure" ? "GitHub Actions gagal. Buka console untuk detail." : ""
  };
}
