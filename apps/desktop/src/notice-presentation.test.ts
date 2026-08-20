import assert from "node:assert/strict";
import test from "node:test";
import {
  activityPresentationKey,
  approvalPresentationKey,
  AutomaticNoticeRegistry,
  matchingPendingSourceIds,
  noticeIsCurrentlyPresented,
  preferPreviouslyPresentedPending,
} from "./notice-presentation";

test("a visible native island prevents the polling loop from presenting it again", () => {
  assert.equal(noticeIsCurrentlyPresented({
    requestedKey: "ask:decision-1",
    activeKey: "ask:decision-1",
    nativeVisible: true,
    browserVisible: false,
  }), true);
});

test("an automatically presented approval only pops once", () => {
  const registry = new AutomaticNoticeRegistry();
  assert.equal(registry.shouldPresent("intent:read-dot-env", 1_000), true);
  assert.equal(registry.shouldPresent("intent:read-dot-env", 2_000), false);
  assert.equal(registry.shouldPresent("intent:different-action", 2_000), true);
});

test("automatic suppression is bounded so a genuinely later event can notify", () => {
  const registry = new AutomaticNoticeRegistry(5_000);
  assert.equal(registry.shouldPresent("decision-1", 1_000), true);
  assert.equal(registry.shouldPresent("decision-1", 5_999), false);
  assert.equal(registry.shouldPresent("decision-1", 6_000), true);
});

test("hook and proxy copies share one stable approval presentation", () => {
  const intentKey = "claude-code|/project|database-mutation|sqlite";
  assert.equal(
    approvalPresentationKey(intentKey, "hook-decision"),
    approvalPresentationKey(intentKey, "proxy-decision"),
  );
  assert.equal(
    activityPresentationKey({ activityKey: "sessions:a", pluginActivity: "blast:1", pendingKey: intentKey }),
    activityPresentationKey({ activityKey: "sessions:b", pluginActivity: "blast:2", pendingKey: intentKey }),
  );
});

test("a pending intent keeps the same representative while sources refresh", () => {
  const keyFor = (item: { intent: string }) => item.intent;
  const previous = [{ id: "proxy-decision", intent: "delete-tables" }];
  const refreshed = [
    { id: "hook-decision", intent: "delete-tables" },
    { id: "proxy-decision", intent: "delete-tables" },
  ];
  assert.deepEqual(preferPreviouslyPresentedPending(refreshed, previous, keyFor), previous);
  assert.deepEqual(
    matchingPendingSourceIds(previous[0], refreshed, keyFor, previous[0].id),
    ["hook-decision", "proxy-decision"],
  );
});
