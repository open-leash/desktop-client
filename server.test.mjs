import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

test("serves the flow UI, health, and bounded NDJSON events", async (context) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "openleash-flow-viewer-"));
  const traceFile = path.join(temporaryDirectory, "flow.ndjson");
  await fs.writeFile(traceFile, [
    JSON.stringify({ id: "one", source: "api_hook" }),
    "not-json",
    JSON.stringify({ id: "two", source: "local_proxy" }),
  ].join("\n"));

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      OPENLEASH_PIPELINE_TRACE_FILE: traceFile,
      OPENLEASH_FLOW_VIEWER_PORT: "0",
      OPENLEASH_FLOW_VIEWER_MAX_EVENTS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    child.kill("SIGTERM");
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  const baseUrl = await listeningUrl(child);
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, traceFile });

  const events = await fetch(`${baseUrl}/api/events`);
  assert.equal(events.status, 200);
  assert.deepEqual(await events.json(), {
    traceFile,
    events: [{ id: "two", source: "local_proxy" }],
  });

  const rejectedClear = await fetch(`${baseUrl}/api/events/clear`, { method: "POST" });
  assert.equal(rejectedClear.status, 403);

  const cleared = await fetch(`${baseUrl}/api/events/clear`, {
    method: "POST",
    headers: { "x-openleash-flow-viewer": "clear" },
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { ok: true });
  assert.equal(await fs.readFile(traceFile, "utf8"), "");

  const emptyEvents = await fetch(`${baseUrl}/api/events`);
  assert.deepEqual(await emptyEvents.json(), {
    traceFile,
    events: [],
  });

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Agent traffic/);
  assert.match(page.headers.get("content-security-policy") || "", /default-src 'self'/);

  const favicon = await fetch(`${baseUrl}/favicon.ico`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get("content-type"), "image/png");
  assert.ok((await favicon.arrayBuffer()).byteLength > 0);

  const traversal = await fetch(`${baseUrl}/..%2Fserver.mjs`);
  assert.equal(traversal.status, 404);
});

function listeningUrl(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`flow-viewer did not start: ${stderr}`)), 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/\[openleash:flow-viewer\] (http:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`flow-viewer exited with ${code}: ${stderr}`));
    });
  });
}
