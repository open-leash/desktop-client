import assert from "node:assert/strict";
import test from "node:test";
import { pluginIconText } from "./plugin-icons.js";

test("first-party plugins use their selected catalog emoji", () => {
  assert.equal(pluginIconText("blast-radius"), "💥");
  assert.equal(pluginIconText("data-leakage-prevention"), "🤫");
  assert.equal(pluginIconText("mcp-scanner"), "📡");
  assert.equal(pluginIconText("token-saver"), "✂️");
});

test("community plugins retain a compact initials fallback", () => {
  assert.equal(pluginIconText("deployment-guard"), "DG");
  assert.equal(pluginIconText("audit"), "AU");
});
