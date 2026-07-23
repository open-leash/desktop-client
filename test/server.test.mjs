import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFlowViewerServer } from "../server.mjs";
import { canonicalPluginSlug, canonicalPluginText } from "../public/plugin-slug.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("renders canonical plugin slugs", () => {
  assert.equal(canonicalPluginSlug("Blast Radius"), "blast-radius");
  assert.equal(canonicalPluginSlug("openleash.blast-radius"), "blast-radius");
  assert.equal(canonicalPluginSlug("openleash.prompt-compression"), "token-saver");
  assert.equal(canonicalPluginSlug("token-compression"), "token-saver");
  assert.equal(canonicalPluginSlug("openleash.core"), "openleash-core");
  assert.equal(canonicalPluginText("Blast Radius checked prompt compression"), "blast-radius checked token-saver");
});

test("serves the viewer and the newest valid trace events", async (context) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "openleash-flow-viewer-"));
  const traceFile = path.join(temporary, "trace.ndjson");
  await writeFile(traceFile, [
    JSON.stringify({ stage: "ingress", source: "api_hook" }),
    "not-json",
    JSON.stringify({ stage: "completed", decision: "allow" }),
    "",
  ].join("\n"));

  const server = createFlowViewerServer({
    host: "127.0.0.1",
    port: 0,
    publicDir: path.join(appDir, "public"),
    traceFile,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, traceFile });

  const events = await fetch(`${origin}/api/events`);
  assert.equal(events.status, 200);
  assert.deepEqual((await events.json()).events, [
    { stage: "ingress", source: "api_hook" },
    { stage: "completed", decision: "allow" },
  ]);

  const cleared = await fetch(`${origin}/api/events/clear`, {
    method: "POST",
    headers: { "x-openleash-flow-viewer": "clear" },
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { ok: true });
  assert.equal((await fetch(`${origin}/api/events`).then((response) => response.json())).events.length, 0);

  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Agent traffic/);

  const missing = await fetch(`${origin}/package.json`);
  assert.equal(missing.status, 404);
});
