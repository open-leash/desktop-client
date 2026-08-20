import type { HookEventName, PipelineEvent } from "@openleash/shared";

export function eventForHookEvent(eventName: HookEventName): PipelineEvent {
  switch (eventName) {
    case "SessionStart":
      return "session.started";
    case "SessionEnd":
      return "session.ended";
    case "UserPromptSubmit":
      return "prompt.beforeSubmit";
    case "PreToolUse":
      return "tool.beforeUse";
    case "PostToolUse":
      return "tool.afterUse";
    case "Stop":
    case "Notification":
    case "SubagentStop":
      return "agent.response";
    case "SubagentStart":
      return "agent.detected";
  }
}
