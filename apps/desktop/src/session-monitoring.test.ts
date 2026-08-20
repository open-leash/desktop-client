import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_MONITORING_PAUSE_MS,
  SessionMonitoringPauses,
  pausableSessionIds,
} from "./session-monitoring";

test("pauses only exact, stable conversation identifiers", () => {
  assert.deepEqual(
    pausableSessionIds(["conversation-1", "conversation-1", "proxy", "unknown", "", null]),
    ["conversation-1"],
  );
});

test("a conversation pause is agent-scoped, bounded, and resumable", () => {
  const pauses = new SessionMonitoringPauses();
  const now = Date.parse("2026-07-29T10:00:00.000Z");
  const pause = pauses.pause("codex", ["conversation-1", "runtime-1"], 60 * 60_000, now);

  assert.equal(pause?.expiresAt, now + SESSION_MONITORING_PAUSE_MS);
  assert.equal(pauses.active("codex", "conversation-1", now)?.expiresAt, pause?.expiresAt);
  assert.equal(pauses.active("claude-code", "conversation-1", now), undefined);
  assert.equal(pauses.active("codex", "conversation-1", now + SESSION_MONITORING_PAUSE_MS), undefined);

  pauses.pause("codex", ["conversation-1", "runtime-1"], 5 * 60_000, now);
  assert.equal(pauses.resume("codex", ["runtime-1"]), true);
  assert.equal(pauses.active("codex", "conversation-1", now), undefined);
});
