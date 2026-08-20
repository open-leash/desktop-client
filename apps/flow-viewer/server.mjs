#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
export function flowViewerConfig(env = process.env) {
  return {
    host: env.OPENLEASH_FLOW_VIEWER_HOST || "127.0.0.1",
    port: Number(env.OPENLEASH_FLOW_VIEWER_PORT || 9340),
    maxEvents: Math.max(
      1,
      Math.min(50_000, Number(env.OPENLEASH_FLOW_VIEWER_MAX_EVENTS || 5000)),
    ),
    publicDir: path.join(appDir, "public"),
    traceFile: path.resolve(
      env.OPENLEASH_PIPELINE_TRACE_FILE ||
        "openleash-flow.ndjson",
    ),
  };
}

export function createFlowViewerServer(options = {}) {
  const config = { ...flowViewerConfig(), ...options };
  return http.createServer(async (request, response) => {
    const url = new URL(
      request.url || "/",
      `http://${request.headers.host || config.host}`,
    );
    try {
      if (url.pathname === "/favicon.ico") url.pathname = "/favicon.png";
      if (url.pathname === "/healthz") {
        return json(response, { ok: true, traceFile: config.traceFile });
      }
      if (request.method === "POST" && url.pathname === "/api/events/clear") {
        if (request.headers["x-openleash-flow-viewer"] !== "clear") {
          return json(response, { error: "forbidden" }, 403);
        }
        await fs.truncate(config.traceFile, 0).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
        return json(response, { ok: true });
      }
      if (url.pathname === "/api/events") {
        const text = await fs.readFile(config.traceFile, "utf8").catch(() => "");
        const events = text
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
        return json(response, {
          traceFile: config.traceFile,
          events: events.slice(-config.maxEvents),
        });
      }

      const asset = url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname.slice(1));
      const resolved = path.resolve(config.publicDir, asset);
      if (
        (!resolved.startsWith(`${config.publicDir}${path.sep}`) &&
          resolved !== path.join(config.publicDir, "index.html"))
      ) {
        return notFound(response);
      }
      const body = await fs.readFile(resolved);
      response.writeHead(200, {
        "content-type": contentType(resolved),
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      });
      response.end(body);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return notFound(response);
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });
}

export async function startFlowViewer(options = {}) {
  const config = { ...flowViewerConfig(), ...options };
  const server = createFlowViewerServer(config);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : config.port;
  console.log(`[openleash:flow-viewer] http://${config.host}:${port}`);
  console.log(`[openleash:flow-viewer] reading ${config.traceFile}`);
  return server;
}

function json(response, value, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function notFound(response) {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startFlowViewer();
}
