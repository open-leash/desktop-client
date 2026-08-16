import assert from "node:assert/strict";
import test from "node:test";
import { shouldResetLocalState } from "./install-state.js";

const install = {
  currentIdentity: "new-bundle",
  previousIdentity: "old-bundle",
  setupComplete: true,
  preserveSettings: false,
  explicitFreshStart: false,
};

test("a fresh install resets existing local state", () => {
  assert.equal(
    shouldResetLocalState({ ...install, previousIdentity: undefined }),
    true,
  );
});

test("a manually replaced app bundle resets local state", () => {
  assert.equal(shouldResetLocalState(install), true);
});

test("an updater-owned replacement preserves state for migrations", () => {
  assert.equal(
    shouldResetLocalState({ ...install, preserveSettings: true }),
    false,
  );
});

test("an ordinary restart of the same bundle preserves state", () => {
  assert.equal(
    shouldResetLocalState({ ...install, previousIdentity: "new-bundle" }),
    false,
  );
});

test("an explicit clean-install launch resets even the same bundle", () => {
  assert.equal(
    shouldResetLocalState({
      ...install,
      previousIdentity: "new-bundle",
      explicitFreshStart: true,
    }),
    true,
  );
});
