import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SESSION_MONITORING_PAUSE_MS,
  isMissingSessionMonitoringSchema,
  normalizeSessionMonitoringScope,
  normalizedSessionPauseExpiry,
  tolerateMissingSessionMonitoringSchema,
} from "./session-monitoring.js";

test("normalizes a bounded exact-session pause scope", () => {
  assert.deepEqual(normalizeSessionMonitoringScope({
    agentKind: " Codex ",
    sessionIds: ["conversation-1", "conversation-1", "proxy", "unknown", ""],
  }), {
    agentKind: "codex",
    sessionIds: ["conversation-1"],
  });
  assert.equal(normalizeSessionMonitoringScope({
    agentKind: "codex",
    sessionIds: ["proxy"],
  }), undefined);
});

test("caps conversation monitoring pauses at thirty minutes", () => {
  const now = Date.parse("2026-07-29T10:00:00.000Z");
  assert.equal(
    normalizedSessionPauseExpiry("2026-07-29T12:00:00.000Z", now).getTime(),
    now + MAX_SESSION_MONITORING_PAUSE_MS,
  );
});

test("recognizes a missing session-monitoring table during rolling deploys", () => {
  assert.equal(isMissingSessionMonitoringSchema({ code: "42P01" }), true);
  assert.equal(isMissingSessionMonitoringSchema({ code: "42703" }), false);
  assert.equal(isMissingSessionMonitoringSchema(new Error("connection failed")), false);
});

test("keeps model traffic available while the pause table migration rolls out", async () => {
  let warned = false;
  const result = await tolerateMissingSessionMonitoringSchema(
    async () => { throw Object.assign(new Error("missing table"), { code: "42P01" }); },
    false,
    () => { warned = true; },
  );
  assert.equal(result, false);
  assert.equal(warned, true);

  await assert.rejects(
    tolerateMissingSessionMonitoringSchema(
      async () => { throw Object.assign(new Error("database offline"), { code: "08006" }); },
      false,
    ),
    /database offline/,
  );
});
