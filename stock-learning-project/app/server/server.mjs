import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const publicDir = path.join(appRoot, "public");
const dataDir = path.join(appRoot, "data");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

async function serveFile(res, file) {
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, mime[path.extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

function runUpdate() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appRoot, "scripts", "generate-research.mjs")], {
      cwd: appRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);

  if (url.pathname === "/api/dashboard") {
    return serveFile(res, path.join(dataDir, "dashboard.json"));
  }

  if (url.pathname === "/api/live-status") {
    return serveFile(res, path.join(dataDir, "live-status.json"));
  }

  if (url.pathname === "/api/update" && req.method === "POST") {
    const result = await runUpdate();
    return send(res, result.code === 0 ? 200 : 500, JSON.stringify(result), "application/json; charset=utf-8");
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  return serveFile(res, path.join(publicDir, safePath));
});

server.listen(port, host, () => {
  console.log(`A-share learning app: http://${host}:${port}`);
});
