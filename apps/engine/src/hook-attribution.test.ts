import assert from "node:assert/strict";
import test from "node:test";
import { attributedHookAgent, isCursorHookPayload } from "./hook-attribution.js";

test("attributes Claude-compatible hooks to Cursor when Cursor identifies itself", () => {
  const payload = {
    hook_event_name: "beforeSubmitPrompt",
    cursor_version: "1.7.42",
    composer_mode: "agent",
    conversation_id: "cursor-session",
  };

  assert.equal(isCursorHookPayload(payload), true);
  assert.equal(attributedHookAgent("claude", payload), "cursor");
});

test("recognizes an explicit Cursor client marker", () => {
  assert.equal(attributedHookAgent("claude", { client_name: "Cursor" }), "cursor");
});

test("does not relabel genuine Claude hooks or other configured agents", () => {
  assert.equal(attributedHookAgent("claude", {
    hook_event_name: "UserPromptSubmit",
    session_id: "claude-session",
  }), "claude");
  assert.equal(attributedHookAgent("codex", { cursor_version: "1.7.42" }), "codex");
  assert.equal(attributedHookAgent("cursor", {}), "cursor");
});
