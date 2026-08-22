import type { HookAgentSlug } from "@openleash/shared";

/**
 * Some IDE agents execute another provider's compatible hook configuration.
 * Cursor, for example, can execute hooks from ~/.claude/settings.json while
 * still identifying itself in the hook payload. Prefer those explicit client
 * markers so persisted activity reflects the application the user operated.
 */
export function attributedHookAgent(
  configuredAgent: HookAgentSlug,
  raw: unknown,
): HookAgentSlug {
  if (configuredAgent === "claude" && isCursorHookPayload(raw)) return "cursor";
  return configuredAgent;
}

export function isCursorHookPayload(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const payload = raw as Record<string, unknown>;
  if (hasValue(payload.cursor_version) || hasValue(payload.cursorVersion)) return true;

  const declaredClient = firstText(
    payload.client,
    payload.client_name,
    payload.clientName,
    payload.application,
    payload.application_name,
    payload.applicationName,
    payload.ide,
  );
  return declaredClient?.toLowerCase() === "cursor";
}

function hasValue(value: unknown) {
  return typeof value === "number" ||
    (typeof value === "string" && value.trim().length > 0);
}

function firstText(...values: unknown[]) {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}
