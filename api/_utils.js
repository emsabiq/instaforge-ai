import { config, boolEnv, clean, cleanBaseUrl } from "../src/config.js";

export { clean };

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true;
  sendJson(res, 405, { error: `Method ${req.method} tidak didukung.` });
  return false;
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    const rawBody = req.body.trim();
    return rawBody ? JSON.parse(rawBody) : {};
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function requireAuth(req, res) {
  const expected = clean(process.env.AUTO_DASHBOARD_PIN);
  if (!expected) {
    sendJson(res, 403, { error: "AUTO_DASHBOARD_PIN belum diset di Vercel Environment." });
    return false;
  }

  const provided = clean(
    req.headers["x-dashboard-pin"]
      || queryValue(req, "pin")
      || cookieValue(req.headers.cookie || "", "instaforge_dashboard_pin")
  );

  if (provided === expected) return true;

  sendJson(res, 401, { error: "PIN dashboard tidak valid atau belum diisi." });
  return false;
}

export function setPinCookie(res, pin) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `instaforge_dashboard_pin=${encodeURIComponent(pin)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`
  );
}

export function clearPinCookie(res) {
  res.setHeader("Set-Cookie", "instaforge_dashboard_pin=; Path=/; Max-Age=0");
}

export function makeId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 6);
  return `${prefix}_${stamp}_${random}`;
}

export function check(name, ok, detail = "", required = true) {
  return { name, ok: Boolean(ok), detail, required };
}

export function configSummary() {
  return {
    appName: config.appName,
    dryRun: boolEnv("DRY_RUN", true),
    autoPublish: boolEnv("AUTO_PUBLISH", false),
    uploadDriver: clean(process.env.UPLOAD_DRIVER || "sftp"),
    publicBaseUrl: cleanBaseUrl(process.env.PUBLIC_BASE_URL),
    instagramEnabled: boolEnv("INSTAGRAM_UPLOAD_ENABLED", true),
    graphApiVersion: clean(process.env.GRAPH_API_VERSION || "v25.0"),
    openaiModel: clean(process.env.OPENAI_MODEL || "gpt-4.1-nano"),
    githubRepo: githubRepo(),
    workflowFile: workflowFile(),
    ref: workflowRef(),
    timezone: clean(process.env.APP_TIMEZONE || "Asia/Jakarta")
  };
}

export async function getRecentRuns(limit = 8) {
  const token = githubToken();
  const repo = githubRepo();
  if (!token || !repo) return [];

  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=${limit}`, {
    headers: githubHeaders(token),
    cache: "no-store"
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.workflow_runs || []).map((run) => ({
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    head_sha: run.head_sha,
    head_branch: run.head_branch,
    display_title: run.display_title || run.head_commit?.message || "",
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url
  }));
}

export async function getRunJobs(runId) {
  const token = githubToken();
  const repo = githubRepo();
  if (!token || !repo || !runId) return [];

  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=30`, {
    headers: githubHeaders(token),
    cache: "no-store"
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.jobs || []).map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    started_at: job.started_at,
    completed_at: job.completed_at,
    html_url: job.html_url,
    steps: (job.steps || []).map((step) => ({
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
      number: step.number,
      started_at: step.started_at,
      completed_at: step.completed_at
    }))
  }));
}

export async function dispatchWorkflow(inputs) {
  const token = githubToken();
  const repo = githubRepo();
  if (!token) throw new Error("GH_REPO_SECRET_TOKEN belum diset di Vercel Environment.");
  if (!repo) throw new Error("DASHBOARD_GITHUB_REPO belum diset.");

  const workflow = workflowFile();
  const ref = workflowRef();
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({ ref, inputs })
    }
  );

  if (response.status === 204) return { ok: true, repo, workflow, ref };

  let detail = "";
  try {
    detail = JSON.stringify(await response.json());
  } catch {
    detail = await response.text();
  }
  throw new Error(`Gagal trigger workflow (${response.status}): ${detail.slice(0, 500)}`);
}

export function remoteMissingEnv() {
  const driver = clean(process.env.UPLOAD_DRIVER || "sftp").toLowerCase();
  const prefix = driver === "sftp" ? "SFTP" : "FTP";
  const fallback = prefix === "SFTP" ? "FTP" : "SFTP";
  const first = (suffix) => clean(process.env[`${prefix}_${suffix}`] || process.env[`${fallback}_${suffix}`]);
  const missing = [];
  if (!first("HOST")) missing.push(`${prefix}_HOST`);
  if (!first("USER")) missing.push(`${prefix}_USER`);
  if (!first("PASSWORD") && !clean(process.env.SFTP_PRIVATE_KEY)) missing.push(`${prefix}_PASSWORD`);
  if (!first("REMOTE_DIR")) missing.push(`${prefix}_REMOTE_DIR`);
  return missing;
}

function githubRepo() {
  return clean(process.env.DASHBOARD_GITHUB_REPO || process.env.GITHUB_REPOSITORY);
}

function workflowFile() {
  return clean(process.env.DASHBOARD_WORKFLOW_FILE || "instagram-ai-video.yml");
}

function workflowRef() {
  return clean(process.env.DASHBOARD_GITHUB_REF || "main");
}

function githubToken() {
  return clean(process.env.GH_REPO_SECRET_TOKEN || process.env.GITHUB_TOKEN);
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "instaforge-ai-dashboard"
  };
}

function queryValue(req, name) {
  try {
    return new URL(req.url, "https://dashboard.local").searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function cookieValue(raw, name) {
  for (const part of String(raw || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}
