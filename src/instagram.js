import axios from "axios";
import { config } from "./config.js";
import { ensureFreshInstagramToken } from "./instagram-token.js";

function apiUrl(apiPath) {
  return `https://graph.facebook.com/${config.graphApiVersion}/${apiPath}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertInstagramConfig() {
  const missing = [];
  if (!config.instagram.igUserId) missing.push("INSTAGRAM_IG_USER_ID");
  if (!config.instagram.accessToken) missing.push("INSTAGRAM_ACCESS_TOKEN");
  if (missing.length) throw new Error(`Missing Instagram config: ${missing.join(", ")}`);
}

function positiveIntEnv(name, fallback, max = 180) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

function describeRequestError(error) {
  if (error?.response) {
    return `status=${error.response.status}, data=${JSON.stringify(error.response.data || {})}`;
  }
  return error?.message || error?.code || error?.name || "unknown_error";
}

function isVideoStatus(status) {
  return (status >= 200 && status < 300) || status === 206;
}

function urlLooksLikeMp4(videoUrl) {
  return String(videoUrl || "").split("?")[0].toLowerCase().endsWith(".mp4");
}

function isAcceptableVideoContentType(contentType, videoUrl) {
  const normalized = String(contentType || "").toLowerCase();
  return (
    normalized.includes("video/mp4") ||
    normalized.includes("application/octet-stream") ||
    (!normalized && urlLooksLikeMp4(videoUrl))
  );
}

function assertVideoProbe({ method, status, contentType, bytes }, videoUrl) {
  if (!isVideoStatus(status)) throw new Error(`${method} status=${status}`);
  if (!isAcceptableVideoContentType(contentType, videoUrl)) {
    throw new Error(`${method} content-type bukan MP4: ${contentType || "kosong"}`);
  }
  if (method === "GET" && !bytes) throw new Error("GET tidak mengembalikan byte video.");
  return true;
}

async function probeVideoHead(videoUrl, attempt) {
  const response = await axios.head(videoUrl, {
    headers: {
      "User-Agent": "facebookexternalhit/1.1",
      Accept: "video/mp4,*/*"
    },
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: () => true
  });

  const contentType = response.headers?.["content-type"] || "";
  console.log("IG VIDEO URL HEAD:", { attempt, status: response.status, contentType });
  return { method: "HEAD", status: response.status, contentType, bytes: 0 };
}

async function probeVideoRange(videoUrl, attempt) {
  const response = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    headers: {
      "User-Agent": "facebookexternalhit/1.1",
      Accept: "video/mp4,*/*",
      Range: "bytes=0-2047"
    },
    timeout: 45000,
    maxRedirects: 5,
    maxContentLength: 12 * 1024 * 1024,
    validateStatus: () => true
  });

  const contentType = response.headers?.["content-type"] || "";
  const bytes = Buffer.from(response.data || []).length;
  console.log("IG VIDEO URL GET:", { attempt, status: response.status, contentType, bytes });
  return { method: "GET", status: response.status, contentType, bytes };
}

async function assertPublicVideoUrl(videoUrl) {
  if (!videoUrl) throw new Error("videoUrl kosong, tidak bisa publish Reels.");

  const maxAttempts = positiveIntEnv("INSTAGRAM_VIDEO_URL_CHECK_ATTEMPTS", 8, 20);
  const delayMs = positiveIntEnv("INSTAGRAM_VIDEO_URL_CHECK_DELAY_SECONDS", 8, 60) * 1000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return assertVideoProbe(await probeVideoHead(videoUrl, attempt), videoUrl);
    } catch (error) {
      lastError = new Error(`HEAD gagal: ${describeRequestError(error)}`);
      console.log("IG VIDEO URL HEAD belum siap:", { attempt, message: lastError.message });
    }

    try {
      return assertVideoProbe(await probeVideoRange(videoUrl, attempt), videoUrl);
    } catch (error) {
      lastError = new Error(`GET gagal: ${describeRequestError(error)}`);
      console.log("IG VIDEO URL GET belum siap:", { attempt, message: lastError.message });
    }

    if (attempt < maxAttempts) await sleep(delayMs);
  }

  throw new Error(
    `Gagal validasi video URL sebelum publish setelah ${maxAttempts} percobaan: ` +
      `${lastError?.message || "unknown_error"}`
  );
}

async function postForm(apiPath, fields) {
  const body = new URLSearchParams({
    ...fields,
    access_token: config.instagram.accessToken
  });

  try {
    const response = await axios.post(apiUrl(apiPath), body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 60000
    });
    return response.data;
  } catch (error) {
    const apiError = error.response?.data?.error;
    if (!apiError) throw error;

    const wrapped = new Error(
      `Instagram API error (${error.response.status}): ${apiError.message} ` +
        `[code ${apiError.code}${apiError.error_subcode ? `, subcode ${apiError.error_subcode}` : ""}]`
    );
    wrapped.apiCode = apiError.code;
    wrapped.apiSubcode = apiError.error_subcode;
    wrapped.apiError = apiError;
    throw wrapped;
  }
}

async function getContainerStatus(containerId) {
  const response = await axios.get(apiUrl(containerId), {
    params: {
      fields: "id,status_code,status",
      access_token: config.instagram.accessToken
    },
    timeout: 30000
  });
  return response.data || {};
}

async function waitForContainerReady(containerId) {
  const maxAttempts = positiveIntEnv("INSTAGRAM_CONTAINER_MAX_ATTEMPTS", 90, 180);
  const pollMs = positiveIntEnv("INSTAGRAM_CONTAINER_POLL_SECONDS", 6, 60) * 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const status = await getContainerStatus(containerId);
    const code = status.status_code || "";
    console.log("IG CONTAINER STATUS:", { attempt, containerId, status_code: code, status: status.status });

    if (code === "FINISHED") return status;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(
        `Instagram reel gagal diproses. container=${containerId}, status_code=${code}, status=${status.status || ""}`
      );
    }

    await sleep(pollMs);
  }

  throw new Error(`Instagram reel belum siap setelah ${maxAttempts} polling: ${containerId}`);
}

export async function publishReel({ videoUrl, caption, coverUrl }) {
  const tokenStatus = await ensureFreshInstagramToken();
  assertInstagramConfig();
  await assertPublicVideoUrl(videoUrl);

  console.log("IG GRAPH VERSION:", config.graphApiVersion);
  console.log("IG REEL UPLOAD METHOD: video_url");

  const params = {
    media_type: "REELS",
    video_url: videoUrl,
    caption: caption || "",
    share_to_feed: "true"
  };
  if (coverUrl) params.cover_url = coverUrl;

  const created = await postForm(`${config.instagram.igUserId}/media`, params);
  console.log("IG REEL CONTAINER CREATED:", created.id);

  await waitForContainerReady(created.id);

  const published = await postForm(`${config.instagram.igUserId}/media_publish`, {
    creation_id: created.id
  });
  console.log("IG REEL PUBLISHED:", published.id);

  return {
    mediaId: published.id,
    containerId: created.id,
    type: "reel_video",
    uploadMethod: "video_url",
    videoUrl,
    tokenStatus
  };
}
