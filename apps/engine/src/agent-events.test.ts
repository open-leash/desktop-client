import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRequest } from "@openleash/shared";
import {
  eventFingerprint,
  normalizeAgentEvent,
  OBSERVATION_ONLY_CAPABILITIES,
  SOURCE_CAPABILITIES,
} from "./agent-events.js";

const request: EvaluationRequest = {
  computer: { hostname: "dev", platform: "test" },
  agent: { kind: "codex", displayName: "Codex" },
  event: {
    eventName: "UserPromptSubmit",
    agentKind: "codex",
    sessionId: "s1",
    prompt: "hello",
    occurredAt: "2026-07-12T00:00:00Z",
    raw: { transport: "ignored" },
  },
};

test("fingerprint is transport independent", () => {
  const copy = structuredClone(request);
  copy.event.raw = { other: "metadata" };
  copy.agent.kind = "unknown";
  copy.event.sessionId = "proxy";
  copy.event.occurredAt = "2026-07-12T00:00:42Z";
  assert.equal(eventFingerprint(request), eventFingerprint(copy));
});

test("response observations cannot advertise effects after delivery", () => {
  const event = normalizeAgentEvent({
    source: "local_proxy",
    provider: "anthropic",
    request,
    capabilities: OBSERVATION_ONLY_CAPABILITIES,
  });
  assert.equal(event.capabilities.observe, true);
  assert.equal(event.capabilities.block, false);
  assert.equal(event.capabilities.rewriteResponse, false);
});

test("source capabilities encode enforcement timing", () => {
  assert.equal(SOURCE_CAPABILITIES.local_proxy.rewritePrompt, true);
  assert.equal(SOURCE_CAPABILITIES.local_proxy.rewriteResponse, false);
  assert.equal(SOURCE_CAPABILITIES.local_proxy.rewriteToolInput, false);
  assert.equal(SOURCE_CAPABILITIES.api_hook.rewritePrompt, false);
  assert.equal(SOURCE_CAPABILITIES.provider_puller.block, false);
  assert.equal(
    normalizeAgentEvent({
      source: "provider_puller",
      provider: "salesforce",
      request,
    }).capabilities.observe,
    true,
  );
});
