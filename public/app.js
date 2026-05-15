const STATE_URL = "/api/state";
const POLL_ACTIVE_MS = 3500;
const POLL_IDLE_MS = 30000;

let dashboardPin =
  new URLSearchParams(window.location.search).get("pin") ||
  window.sessionStorage.getItem("instaforgePin") ||
  "";
let pollTimer = null;
let authVisible = true;
let lastRunStatus = "idle";

if (dashboardPin) {
  window.sessionStorage.setItem("instaforgePin", dashboardPin);
  const cleanUrl = new URL(window.location.href);
  if (cleanUrl.searchParams.has("pin")) {
    cleanUrl.searchParams.delete("pin");
    window.history.replaceState({}, "", cleanUrl);
  }
}

const els = {
  authOverlay: document.querySelector("#authOverlay"),
  authForm: document.querySelector("#authForm"),
  authPin: document.querySelector("#authPin"),
  authError: document.querySelector("#authError"),
  configLine: document.querySelector("#configLine"),
  preflightBtn: document.querySelector("#preflightBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  metricGrid: document.querySelector("#metricGrid"),
  runForm: document.querySelector("#runForm"),
  runTitle: document.querySelector("#runTitle"),
  runLink: document.querySelector("#runLink"),
  runStatus: document.querySelector("#runStatus"),
  runDetail: document.querySelector("#runDetail"),
  runProgress: document.querySelector("#runProgress"),
  progressBar: document.querySelector("#progressBar"),
  consoleOutput: document.querySelector("#consoleOutput"),
  runCount: document.querySelector("#runCount"),
  runRows: document.querySelector("#runRows")
};

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json" };
  if (options.body) headers["Content-Type"] = "application/json";
  if (dashboardPin) headers["X-Dashboard-Pin"] = dashboardPin;

  const response = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || "Request gagal.", response.status);
  return data;
}

async function refresh() {
  const state = await api(STATE_URL);
  hideAuth();
  renderConfig(state.config || {});
  renderMetrics(state.config || {}, state.activeRun, state.recentRuns || []);
  renderActiveRun(state.activeRun);
  renderRuns(state.recentRuns || []);
}

function renderConfig(cfg) {
  const parts = [
    cfg.dryRun ? "dry-run" : "live",
    cfg.autoPublish ? "publish on" : "publish off",
    `storage ${(cfg.uploadDriver || "sftp").toUpperCase()}`,
    "Instagram only",
    cfg.openaiModel || "OpenAI"
  ];
  els.configLine.textContent = parts.join(" / ");
}

function renderMetrics(cfg, activeRun, runs) {
  const latest = runs[0] || null;
  const lastOk = latest?.conclusion === "success";
  els.metricGrid.innerHTML = [
    metric("Mode", cfg.dryRun ? "Dry" : "Live", cfg.autoPublish ? "auto publish" : "manual", cfg.dryRun ? "warn" : "ok"),
    metric("Instagram", cfg.instagramEnabled ? "On" : "Off", cfg.graphApiVersion || "Graph", cfg.instagramEnabled ? "ok" : "bad"),
    metric("Workflow", activeRun?.status || "Idle", cfg.workflowFile || "-", activeRun?.status === "running" ? "info" : "ok"),
    metric("Run terakhir", latest ? latest.conclusion || latest.status : "-", latest ? formatDateTime(latest.created_at) : "belum ada", lastOk ? "ok" : "warn")
  ].join("");
}

function metric(label, value, detail, tone) {
  return `
    <article class="metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function renderActiveRun(run) {
  const running = run?.status === "running";
  const pct = typeof run?.progress === "number" ? run.progress : running ? 8 : run ? 100 : 0;
  els.runTitle.textContent = run?.title || run?.name || "Menunggu proses";
  els.runStatus.textContent = run?.status || "Idle";
  els.runDetail.textContent = run?.detail || run?.error || "Siap membuat video baru.";
  els.runProgress.textContent = `${pct}%`;
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.classList.toggle("running", running);
  els.runLink.href = run?.htmlUrl || "#";
  els.runLink.hidden = !run?.htmlUrl;
  lastRunStatus = running ? "running" : "idle";
  setSubmitDisabled(running);

  if (run?.jobs?.length) {
    els.consoleOutput.textContent = run.jobs.flatMap((job) =>
      (job.steps || []).map((step) =>
        `[${formatTime(step.started_at) || "--:--"}] ${job.name} / ${step.name}: ${step.status}${step.conclusion ? `/${step.conclusion}` : ""}`
      )
    ).join("\n") || "Menunggu runner.";
  } else if (!run) {
    els.consoleOutput.textContent = "Belum ada output.";
  }
}

function renderRuns(runs) {
  els.runCount.textContent = `${runs.length} run`;
  els.runRows.innerHTML = runs.map((run) => `
    <tr>
      <td data-label="Status">${pill(run.conclusion || run.status)}</td>
      <td data-label="Workflow">${escapeHtml(short(run.display_title || run.name || "Workflow", 56))}</td>
      <td data-label="Branch">${escapeHtml(run.head_branch || "-")}</td>
      <td data-label="Waktu">${escapeHtml(formatDateTime(run.created_at))}</td>
      <td data-label="Link"><a href="${escapeAttr(run.html_url || "#")}" target="_blank" rel="noreferrer">Console</a></td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="emptyRow">Belum ada run.</td></tr>`;
}

function setSubmitDisabled(disabled) {
  const button = els.runForm?.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = disabled;
  button.textContent = disabled ? "Workflow berjalan..." : "Generate";
}

function showAuth(message = "") {
  authVisible = true;
  document.body.classList.add("authLocked");
  els.authOverlay.classList.add("active");
  els.authOverlay.setAttribute("aria-hidden", "false");
  els.authError.textContent = message;
  window.setTimeout(() => els.authPin.focus(), 30);
  stopPolling();
}

function hideAuth() {
  if (!authVisible) return;
  authVisible = false;
  document.body.classList.remove("authLocked");
  els.authOverlay.classList.remove("active");
  els.authOverlay.setAttribute("aria-hidden", "true");
  els.authError.textContent = "";
  schedulePoll();
}

function handleApiError(error, target = els.runDetail) {
  if (error.status === 401 || error.status === 403 || /PIN|AUTO_DASHBOARD_PIN/i.test(error.message)) {
    window.sessionStorage.removeItem("instaforgePin");
    dashboardPin = "";
    showAuth(error.message);
    return;
  }
  if (target) target.textContent = error.message;
}

function schedulePoll() {
  stopPolling();
  if (document.hidden || authVisible) return;
  const ms = lastRunStatus === "running" ? POLL_ACTIVE_MS : POLL_IDLE_MS;
  pollTimer = window.setTimeout(async () => {
    try {
      await refresh();
    } catch (error) {
      handleApiError(error);
    } finally {
      schedulePoll();
    }
  }, ms);
}

function stopPolling() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
}

function formData(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value).trim()]));
}

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = els.authPin.value.trim();
  if (!pin) {
    els.authError.textContent = "PIN wajib diisi.";
    return;
  }
  try {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ pin }) });
    dashboardPin = pin;
    window.sessionStorage.setItem("instaforgePin", pin);
    hideAuth();
    await refresh();
  } catch (error) {
    els.authError.textContent = error.message;
  }
});

els.runForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setSubmitDisabled(true);
  try {
    const payload = formData(els.runForm);
    payload.publish = Boolean(els.runForm.elements.publish.checked);
    await api("/api/run", { method: "POST", body: JSON.stringify(payload) });
    els.runStatus.textContent = "queued";
    els.runDetail.textContent = "Workflow dikirim ke GitHub Actions.";
    await refresh();
  } catch (error) {
    setSubmitDisabled(false);
    handleApiError(error);
  }
});

els.preflightBtn.addEventListener("click", async () => {
  els.runStatus.textContent = "preflight";
  els.runDetail.textContent = "Cek konfigurasi dashboard dan workflow.";
  try {
    const report = await api("/api/preflight", { method: "POST", body: "{}" });
    const failed = (report.checks || []).filter((item) => !item.ok && item.required);
    els.runDetail.textContent = failed.length ? `Gagal: ${failed.map((item) => item.name).join(", ")}` : "Preflight OK.";
    els.consoleOutput.textContent = (report.checks || [])
      .map((item) => `${item.ok ? "OK  " : item.required ? "FAIL" : "WARN"} ${item.name}${item.detail ? ` - ${item.detail}` : ""}`)
      .join("\n");
  } catch (error) {
    handleApiError(error);
  }
});

els.refreshBtn.addEventListener("click", () => {
  refresh().catch((error) => handleApiError(error));
});

els.logoutBtn.addEventListener("click", async () => {
  window.sessionStorage.removeItem("instaforgePin");
  dashboardPin = "";
  await api("/api/auth", { method: "DELETE" }).catch(() => {});
  showAuth("Anda sudah keluar.");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
    return;
  }
  if (authVisible) return;
  refresh().catch((error) => handleApiError(error));
  schedulePoll();
});

refresh().catch((error) => handleApiError(error));

function pill(status) {
  const label = status || "queued";
  const safe = String(label).replace(/[^a-z0-9_-]/gi, "_");
  return `<span class="pill ${escapeAttr(safe)}">${escapeHtml(label)}</span>`;
}

function formatTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("id-ID", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function short(value, length = 54) {
  const text = String(value || "");
  return text.length <= length ? text : `${text.slice(0, length - 1)}...`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

