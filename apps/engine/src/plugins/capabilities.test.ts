import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRequest } from "@openleash/shared";
import { modelConfigFor } from "../evaluator.js";
import { createPluginCapabilities, pluginModelConfig } from "./capabilities.js";

function request(): EvaluationRequest {
  return {
    computer: { hostname: "test", platform: "test" },
    agent: { kind: "claude-code", displayName: "Claude Code" },
    event: {
      eventName: "Stop",
      agentKind: "claude-code",
      sessionId: "session-1",
      occurredAt: new Date().toISOString(),
      transcript: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
    },
  };
}

test("recent conversation context is bounded to the current request session", async () => {
  const capabilities = createPluginCapabilities({
    pluginId: "acme.memory",
    request: request(),
    permissions: ["conversation:read"],
  });
  const result = await capabilities.context.conversation.recent({ limit: 2 });
  assert.deepEqual(result, {
    sessionId: "session-1",
    turns: [
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ],
    truncated: true,
  });
});

test("capability methods reject undeclared permissions", async () => {
  const capabilities = createPluginCapabilities({
    pluginId: "acme.unprivileged",
    request: request(),
    permissions: ["event:read"],
  });
  await assert.rejects(
    capabilities.context.conversation.recent(),
    /requires conversation:read/,
  );
  await assert.rejects(
    capabilities.storage.get({ key: "private" }),
    /requires storage:read/,
  );
  await assert.rejects(
    capabilities.log.emit({ level: "info", message: "not allowed" }),
    /requires log:write/,
  );
});

test("portable plugin state enforces bounded JSON values", async () => {
  const capabilities = createPluginCapabilities({
    pluginId: "acme.memory",
    request: request(),
    permissions: ["storage:write"],
  });
  await assert.rejects(
    capabilities.storage.set({
      key: "too-large",
      value: { content: "x".repeat(256 * 1024) },
    }),
    /256 KiB limit/,
  );
  await assert.rejects(
    capabilities.storage.set({ key: "", value: {} }),
    /1 to 240 characters/,
  );
});

test("plugin evaluation ignores an ambient agent OPENAI_API_KEY", () => {
  assert.equal(
    pluginModelConfig(undefined, {
      OPENAI_API_KEY: "agent-owned-key",
    }),
    undefined,
  );
  assert.deepEqual(
    pluginModelConfig(undefined, {
      OPENAI_API_KEY: "agent-owned-key",
      OPENLEASH_OPENAI_API_KEY: "managed-evaluation-key",
    }),
    {
      provider: "openai",
      apiKey: "managed-evaluation-key",
      source: "openleash-managed",
    },
  );
});

test("approval summaries ignore an ambient agent OPENAI_API_KEY", () => {
  assert.equal(
    modelConfigFor(undefined, {
      OPENAI_API_KEY: "agent-owned-key",
    }),
    undefined,
  );
  assert.deepEqual(
    modelConfigFor(undefined, {
      OPENLEASH_OPENAI_API_KEY: "managed-evaluation-key",
    }),
    {
      provider: "openai",
      apiKey: "managed-evaluation-key",
      source: "openleash-managed",
    },
  );
});
