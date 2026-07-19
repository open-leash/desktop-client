import assert from "node:assert/strict";
import test from "node:test";
import {
  AutomaticNoticeRegistry,
  noticeIsCurrentlyPresented,
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
