#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const image = "ghcr.io/open-leash/plugin-token-saver:1.1.1@sha256:4b681430b8455c42e2bdcc66500fc60c5b4bc197eb3db4817fb44cd69d6814c5";
const name = `openleash-token-saver-e2e-${process.pid}`;
const secret = crypto.randomBytes(32).toString("hex");

try {
  run("docker", ["run", "-d", "--name", name, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,mode=1777", "--tmpfs", "/data:rw,noexec,nosuid,size=512m,mode=1777", "-e", `OPENLEASH_PLUGIN_RUNTIME_SECRET=${secret}`, "-p", "127.0.0.1::8080", image]);
  const port = run("docker", ["port", name, "8080/tcp"]).trim().split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base);

  const marker = "OPENLEASH_E2E_MARKER";
  const verbose = `${marker}\n${Array.from({ length: 500 }, (_, index) => `2026-07-15T12:00:${String(index % 60).padStart(2, "0")}Z INFO request completed status=200 duration=${index}ms`).join("\n")}`;
  const envelope = {
    protocol: "openleash-container-plugin.v1",
    requestId: crypto.randomUUID(),
    plugin: { id: "openleash.prompt-compression", version: "1.1.1" },
    tenant: { organizationId: "org-e2e", userId: "user-e2e" },
    event: "provider.request.beforeSend",
    context: { provider: "openai", agentKind: "codex", agentId: "agent-e2e", sessionId: "session-e2e" },
    settings: { profileIds: ["user:codex-e2e"], configHash: crypto.createHash("sha256").update("profile").digest("hex") },
    config: { enabled: true, level: "maximum", minimumChars: 256, protectRecent: 0, ccrEnabled: true, ccrTtlSeconds: 3600 },
    payload: { model: "gpt-test", messages: [{ role: "tool", content: verbose }] },
  };
  const transformed = await signedPost(base, "/v1/transform", envelope);
  assert(transformed.status === "modified", `expected modified, got ${JSON.stringify(transformed)}`);
  assert(transformed.metrics?.headroom === true, "Headroom engine marker is missing");
  assert(transformed.metrics?.tokensSaved > 0, "Token Saver reported no token savings");
  assert(transformed.settings === undefined, "plugin response must not echo tenant settings");
  const output = JSON.stringify(transformed.patches);
  assert(output.includes(marker), "compression lost the protected marker");
  assert(output.length < verbose.length, "compressed provider payload was not shorter");
  assert(transformed.emissions?.logs?.[0]?.code === "headroom-compression", "compression log emission is missing");
  assert(transformed.emissions?.usage?.[0]?.savedTokens > 0, "usage emission has no saved tokens");

  const hash = transformed.ccrHashes?.[0];
  assert(hash, "CCR hash was not returned");
  const toolEnvelope = {
    protocol: envelope.protocol,
    requestId: crypto.randomUUID(),
    plugin: envelope.plugin,
    tenant: envelope.tenant,
    event: "plugin.tool.execute",
    context: { sessionId: "session-e2e" },
    settings: envelope.settings,
    config: envelope.config,
    tool: "headroom_retrieve",
    arguments: { hash },
  };
  const retrieved = await signedPost(base, "/v1/tools/execute", toolEnvelope);
  assert(retrieved.content === verbose, "CCR retrieval did not return the original content");

  const disabled = structuredClone(envelope);
  disabled.requestId = crypto.randomUUID();
  disabled.config = { ...disabled.config, enabled: false };
  const skipped = await signedPost(base, "/v1/transform", disabled);
  assert(skipped.status === "skipped", "a disabled agent profile still transformed the request");

  const unauthorized = await fetch(`${base}/v1/transform`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });
  assert(unauthorized.status === 401, `unsigned request returned ${unauthorized.status}`);
  console.log(`Token Saver container E2E passed: ${transformed.metrics.tokensSaved} tokens saved, CCR restored, scoped disable honored, unsigned traffic rejected.`);
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}

async function signedPost(base, path, body) {
  const raw = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openleash-timestamp": timestamp, "x-openleash-signature": `sha256=${signature}` },
    body: raw,
  });
  const result = await response.json().catch(() => ({}));
  assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(result)}`);
  assert(result.protocol === body.protocol && result.requestId === body.requestId, "uncorrelated plugin response");
  return result;
}

async function waitForHealth(base) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${base}/healthz`).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Token Saver did not become healthy");
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
