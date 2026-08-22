import assert from "node:assert/strict";
import test from "node:test";
import { shouldLaunchInBackground } from "./startup-visibility.js";

const ordinaryLaunch = {
  forceVisible: false,
  hiddenArgument: false,
  wasOpenedAtLogin: false,
  wasOpenedAsHidden: false,
};

test("a modern macOS login launch stays in the background", () => {
  assert.equal(
    shouldLaunchInBackground({
      ...ordinaryLaunch,
      wasOpenedAtLogin: true,
    }),
    true,
  );
});

test("the deprecated hidden login signal remains supported", () => {
  assert.equal(
    shouldLaunchInBackground({
      ...ordinaryLaunch,
      wasOpenedAsHidden: true,
    }),
    true,
  );
});

test("an explicit hidden launch stays in the background", () => {
  assert.equal(
    shouldLaunchInBackground({
      ...ordinaryLaunch,
      hiddenArgument: true,
    }),
    true,
  );
});

test("an ordinary user launch opens the main window", () => {
  assert.equal(shouldLaunchInBackground(ordinaryLaunch), false);
});

test("an explicit visible launch overrides login signals", () => {
  assert.equal(
    shouldLaunchInBackground({
      forceVisible: true,
      hiddenArgument: true,
      wasOpenedAtLogin: true,
      wasOpenedAsHidden: true,
    }),
    false,
  );
});
