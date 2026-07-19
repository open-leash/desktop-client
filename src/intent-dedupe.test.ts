import assert from "node:assert/strict";
import test from "node:test";
import {
  handledIntentKeysMatch,
  isReusableHandledIntent,
} from "./intent-dedupe";

test("local credential approval bridges hook and proxy project metadata", () => {
  assert.equal(
    handledIntentKeysMatch(
      "claude-code|/Users/max/Code/MyProj|credential-read|.env",
      "claude-code||credential-read|.env",
    ),
    true,
  );
});

test("local credential approval stays isolated across known projects", () => {
  assert.equal(
    handledIntentKeysMatch(
      "claude-code|/project-a|credential-read|.env",
      "claude-code|/project-b|credential-read|.env",
    ),
    false,
  );
});

test("local prompt reuse requires an explicit ask decision", () => {
  assert.equal(isReusableHandledIntent({ eventName: "UserPromptSubmit", decision: "allow" }), false);
  assert.equal(isReusableHandledIntent({ eventName: "UserPromptSubmit", decision: "ask" }), true);
});
