import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRequest } from "@openleash/shared";
import { agentInteractionForRequest } from "./agent-interactions.js";

function request(toolName: string, input: unknown): EvaluationRequest {
  return {
    computer: { hostname: "dev", platform: "darwin" },
    agent: { kind: "claude-code", displayName: "Claude Code" },
    event: {
      eventName: "PreToolUse",
      agentKind: "claude-code",
      sessionId: "session-1",
      projectPath: "/code/project",
      occurredAt: "2026-07-19T00:00:00.000Z",
      tool: { name: toolName, input },
    },
  };
}

test("AskUserQuestion becomes a native question interaction", () => {
  const result = agentInteractionForRequest(
    request("AskUserQuestion", {
      questions: [
        {
          question: "Which deployment target?",
          options: [{ label: "Production" }, { label: "Staging" }],
        },
      ],
    }),
  );
  assert.equal(result?.kind, "question");
  assert.equal(result?.summary, "Which deployment target?");
});

test("ExitPlanMode becomes a plan review interaction", () => {
  assert.equal(agentInteractionForRequest(request("ExitPlanMode", {}))?.kind, "plan");
});

test("ordinary tool calls remain policy-driven", () => {
  assert.equal(agentInteractionForRequest(request("Bash", { command: "npm test" })), undefined);
});
