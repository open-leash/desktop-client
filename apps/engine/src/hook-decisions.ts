import type {
  EvaluationResponse,
  HookAgentSlug,
  HookEventName,
} from "@openleash/shared";

export function nativeHookDecision(
  agent: HookAgentSlug,
  eventName: HookEventName,
  decision: EvaluationResponse,
) {
  const reason = humanDecisionReason(decision);
  if (agent === "copilot") {
    if (eventName === "PreToolUse") {
      return {
        permissionDecision: decision.decision,
        permissionDecisionReason: reason,
      };
    }
    if (eventName === "Stop" || eventName === "SubagentStop") {
      return {
        decision: decision.decision === "deny" ? "block" : "allow",
        reason,
      };
    }
    return {};
  }
  if (agent === "claude" || agent === "nanoclaw") {
    if (eventName === "PreToolUse") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: decision.decision,
          permissionDecisionReason: reason,
          ...(decision.resolutionPayload
            ? { updatedInput: decision.resolutionPayload }
            : {}),
        },
        suppressOutput: true,
      };
    }
    return {
      continue: decision.decision !== "deny",
      stopReason: reason,
      suppressOutput: true,
    };
  }
  if (agent === "codex") {
    if (decision.decision !== "deny") {
      if (eventName === "PreToolUse" && decision.resolutionPayload) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: decision.resolutionPayload,
          },
        };
      }
      return {};
    }
    if (
      eventName === "UserPromptSubmit" ||
      eventName === "PreToolUse" ||
      eventName === "PostToolUse"
    ) {
      return { decision: "block", reason };
    }
    return {
      continue: false,
      stopReason: reason,
    };
  }
  return {
    decision: decision.decision === "deny" ? "block" : decision.decision,
    reason,
    ...(decision.resolutionPayload
      ? {
          response: decision.resolutionPayload,
          updatedInput: decision.resolutionPayload,
        }
      : {}),
  };
}

function humanDecisionReason(decision: EvaluationResponse) {
  if (decision.decision === "allow") return "Leash approved this action.";
  if (decision.decision === "deny" && decision.resolutionGuidance) {
    return `Leash denied this action. User guidance: ${decision.resolutionGuidance}`;
  }
  if (decision.decision === "deny")
    return decision.summary || "Leash denied this action.";
  return decision.question ?? decision.summary;
}
