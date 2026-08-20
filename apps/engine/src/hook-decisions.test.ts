import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationResponse } from "@openleash/shared";
import { nativeHookDecision } from "./hook-decisions.js";

function decision(
  value: "allow" | "deny",
  overrides: Partial<EvaluationResponse> = {},
): EvaluationResponse {
  return {
    decision: value,
    decisionId: "decision-1",
    summary: value === "deny" ? "Blocked by policy." : "Allowed.",
    results: [],
    ...overrides,
  };
}

test("Codex allow responses stay silent so hooks succeed", () => {
  assert.deepEqual(
    nativeHookDecision("codex", "UserPromptSubmit", decision("allow")),
    {},
  );
  assert.deepEqual(nativeHookDecision("codex", "Stop", decision("allow")), {});
});

test("Codex denials use its supported blocking contract", () => {
  assert.deepEqual(
    nativeHookDecision("codex", "PreToolUse", decision("deny")),
    {
      decision: "block",
      reason: "Blocked by policy.",
    },
  );
});

test("Codex tool rewrites use permissionDecision with updatedInput", () => {
  assert.deepEqual(
    nativeHookDecision(
      "codex",
      "PreToolUse",
      decision("allow", {
        resolutionPayload: { command: "printf safe" },
      }),
    ),
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "printf safe" },
      },
    },
  );
});
