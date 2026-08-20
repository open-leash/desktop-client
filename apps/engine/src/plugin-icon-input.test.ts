import assert from "node:assert/strict";
import test from "node:test";
import {
  isSingleEmoji,
  normalizePluginIconInput,
} from "./plugin-icon-input.js";

test("accepts exactly one emoji", () => {
  assert.equal(isSingleEmoji("🛡️"), true);
  assert.equal(isSingleEmoji("👩🏽‍💻"), true);
  assert.equal(isSingleEmoji("🛡️🔐"), false);
  assert.equal(isSingleEmoji("AB"), false);
  assert.deepEqual(normalizePluginIconInput({ iconText: "🔐" }), {
    iconText: "🔐",
    visualPng: "",
  });
});

test("accepts a small valid PNG and makes it authoritative", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  assert.deepEqual(
    normalizePluginIconInput({ iconText: "🔐", visualPng: png }),
    { iconText: "", visualPng: png },
  );
});

test("rejects mislabeled or unsafe image formats", () => {
  assert.throws(
    () =>
      normalizePluginIconInput({
        visualPng: "data:image/svg+xml;base64,PHN2Zz4=",
      }),
    /PNG, JPEG, or WebP/,
  );
  assert.throws(
    () =>
      normalizePluginIconInput({ visualPng: "data:image/png;base64,SGVsbG8=" }),
    /does not match/,
  );
});
