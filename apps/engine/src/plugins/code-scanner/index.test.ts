import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRequest, PluginCapabilities } from "@openleash/shared";
import { generatedCodeCandidate, runCodeScanner } from "./index.js";
import { codeScannerManifest } from "./manifest.js";
import { pluginSupportsAgent } from "../registry.js";

function request(
  agentKind: EvaluationRequest["agent"]["kind"],
  toolInput: unknown,
): EvaluationRequest {
  return {
    computer: { hostname: "test", platform: "darwin" },
    agent: { kind: agentKind, displayName: agentKind },
    event: {
      eventName: "PreToolUse",
      agentKind,
      sessionId: "session-1",
      occurredAt: new Date(0).toISOString(),
      tool: { name: "Write", input: toolInput },
    },
  };
}

function capabilities(assessment: unknown) {
  const calls = { notifications: 0, signals: 0, logs: 0 };
  const value = {
    llm: {
      evaluateJson: async () => ({
        json: assessment,
        model: "test-model",
        provider: "test",
        source: "heuristic" as const,
      }),
    },
    notification: {
      send: async () => {
        calls.notifications += 1;
        return { sent: true, deduped: false };
      },
    },
    signals: {
      emit: async (entry: unknown) => {
        calls.signals += 1;
        return entry;
      },
    },
    log: {
      emit: async (entry: unknown) => {
        calls.logs += 1;
        return entry;
      },
    },
  } as unknown as PluginCapabilities;
  return { value, calls };
}

test("manifest limits execution to vibe-coding agents", () => {
  assert.equal(pluginSupportsAgent(codeScannerManifest, "claude-code"), true);
  assert.equal(pluginSupportsAgent(codeScannerManifest, "cursor"), true);
  assert.equal(
    pluginSupportsAgent(codeScannerManifest, "salesforce-agentforce"),
    false,
  );
  assert.equal(pluginSupportsAgent(codeScannerManifest, "openclaw"), false);
});

test("extracts code from coding-agent file tools and ignores prose", () => {
  const risky = request("codex", {
    content:
      "import os\n\ndef run(user):\n    command = 'echo ' + user\n    return os.system(command)\n",
  });
  assert.match(generatedCodeCandidate(risky, 40)?.code ?? "", /os\.system/);
  assert.equal(
    generatedCodeCandidate(
      request("codex", { content: "Updated the file successfully." }),
      40,
    ),
    undefined,
  );
});

test("risky assessment logs, signals, and notifies without blocking", async () => {
  const mock = capabilities({
    risky: true,
    riskScore: 94,
    severity: "critical",
    summary: "User input reaches a shell command.",
    vulnerabilities: [
      {
        title: "Command injection",
        severity: "critical",
        cwe: "CWE-78",
        evidence: "os.system(command)",
        remediation: "Use a fixed argument array without a shell.",
      },
    ],
  });
  const result = await runCodeScanner(
    request("claude-code", {
      content:
        "import os\n\ndef run(user):\n    command = 'echo ' + user\n    return os.system(command)\n",
    }),
    "tool.beforeUse",
    mock.value,
  );
  assert.equal(result.status, "passed");
  assert.equal(result.metadata?.notificationSent, true);
  assert.equal(mock.calls.notifications, 1);
  assert.equal(mock.calls.signals, 1);
  assert.equal(mock.calls.logs, 1);
});

test("clean assessment is logged without notifying", async () => {
  const mock = capabilities({
    risky: false,
    riskScore: 5,
    severity: "none",
    summary: "No concrete vulnerability.",
    vulnerabilities: [],
  });
  const result = await runCodeScanner(
    request("github-copilot", {
      content:
        "export function add(left: number, right: number) {\n  if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('invalid');\n  return left + right;\n}\n",
    }),
    "tool.beforeUse",
    mock.value,
  );
  assert.equal(result.metadata?.notificationSent, false);
  assert.equal(mock.calls.notifications, 0);
  assert.equal(mock.calls.signals, 0);
  assert.equal(mock.calls.logs, 1);
});
