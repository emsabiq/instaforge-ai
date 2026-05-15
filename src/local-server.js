import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const apiDir = path.join(rootDir, "api");
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function serveApi(req, res, pathname) {
  const name = pathname.replace(/^\/api\//, "");
  if (!/^[a-z0-9_-]+$/i.test(name)) {
    send(res, 404, JSON.stringify({ error: "API route tidak ditemukan." }), {
      "Content-Type": "application/json; charset=utf-8"
    });
    return;
  }

  const filePath = path.join(apiDir, `${name}.js`);
  try {
    await fs.access(filePath);
    const moduleUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
    const mod = await import(moduleUrl);
    await mod.default(req, res);
  } catch (error) {
    send(res, error.code === "ENOENT" ? 404 : 500, JSON.stringify({ error: error.message }), {
      "Content-Type": "application/json; charset=utf-8"
    });
  }
}

async function serveStatic(req, res, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, relativePath);
  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    send(res, 200, body, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await serveApi(req, res, url.pathname);
    return;
  }
  await serveStatic(req, res, url.pathname);
});

server.listen(port, () => {
  console.log(`InstaForge AI local dashboard: http://localhost:${port}`);
});
