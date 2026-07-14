import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalOpenLeashServer } from "./local-server";
import type { PluginCatalogItem } from "./plugin-catalog";

test("desktop client-api edge transforms provider requests through a container API", async () => {
  const runtime = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const envelope = JSON.parse(raw);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url === "/v1/tools/execute" ? {
        protocol: "openleash-container-plugin.v1",
        requestId: envelope.requestId,
        status: "ok",
        content: "original",
      } : {
          protocol: "openleash-container-plugin.v1",
          requestId: envelope.requestId,
          status: "modified",
          patches: [{ op: "replace", path: "/messages/0/content", value: "compressed" }],
        }));
    });
  });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  const runtimeAddress = runtime.address();
  assert.ok(runtimeAddress && typeof runtimeAddress === "object");
  const pluginPort = runtimeAddress.port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openleash-edge-test-"));
  const edge = new LocalOpenLeashServer(dir, { apiPort: 0, legacyAuthPort: 0 });
  try {
    const plugin: PluginCatalogItem = {
      id: "openleash.test-container",
      name: "test-container",
      description: "test",
      version: "1.0.0",
      publisher: "openleash",
      runtime: "container",
      execution: {
        type: "container",
        placement: "edge",
        protocol: "openleash-container-plugin.v1",
        image: "example/test:1.0.0",
        edgePort: pluginPort,
        toolExecutePath: "/v1/tools/execute",
      },
      entrypoint: "container",
      events: ["provider.request.beforeSend"],
      permissions: ["provider-request:read", "provider-request:write", "network:access"],
      effects: ["transform"],
      settings: { enabled: true, installedVersion: "1.0.0", config: {} },
    };
    edge.syncPlugins([plugin]);
    await edge.start();
    const response = await fetch(`${edge.apiUrl}/v1/plugin-runtime/transform`, {
      method: "POST",
      headers: { authorization: `Bearer ${edge.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        agentKind: "codex",
        sessionId: "edge-test",
        requestBody: { messages: [{ role: "tool", content: "large" }] },
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.requestBody.messages[0].content, "compressed");
    assert.deepEqual(result.appliedPluginIds, [plugin.id]);
    const toolResponse = await fetch(`${edge.apiUrl}/v1/plugin-runtime/tools/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${edge.token}`, "content-type": "application/json" },
      body: JSON.stringify({ pluginId: plugin.id, sessionId: "edge-test", tool: "retrieve", arguments: { hash: "abc" } }),
    });
    assert.equal(toolResponse.status, 200);
    assert.equal((await toolResponse.json() as any).content, "original");
  } finally {
    await edge.stop();
    runtime.closeIdleConnections();
    runtime.closeAllConnections();
    await new Promise<void>((resolve) => runtime.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
