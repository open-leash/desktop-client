import assert from "node:assert/strict";
import test from "node:test";
import {
  handledIntentKeysMatch,
  isReusableHandledIntent,
  pendingIntentKey,
} from "./intent-dedupe.js";

test("credential approval matches hook and proxy copies when proxy lacks project path", () => {
  assert.equal(
    handledIntentKeysMatch(
      "claude-code|/Users/max/Code/MyProj|credential-read|.env",
      "claude-code||credential-read|.env",
    ),
    true,
  );
});

test("pending prompt copies dedupe despite session tags and different summaries", () => {
  const hook = pendingIntentKey({
    agentKind: "claude-code",
    projectPath: "/project",
    prompt: "<session>there's an sqlite file in this folder. drop all the tables please.</session>",
    summary: "Sensitive access review",
  });
  const proxy = pendingIntentKey({
    agentKind: "claude-code",
    projectPath: "/project",
    prompt: "there's an sqlite file in this folder. drop all the tables please.",
    summary: "Database mutation",
  });
  assert.equal(hook, proxy);
});

test("database destruction prompt variants share one pending notice", () => {
  assert.equal(
    pendingIntentKey({ agentKind: "claude-code", projectPath: "/project", prompt: "delete all tables in my sqlite database" }),
    pendingIntentKey({ agentKind: "claude-code", projectPath: "/project", prompt: "delete my tables in sqlite file here" }),
  );
});

test("credential approval does not cross known projects, resources, or agents", () => {
  const approved = "claude-code|/project-a|credential-read|.env";
  assert.equal(handledIntentKeysMatch(approved, "claude-code|/project-b|credential-read|.env"), false);
  assert.equal(handledIntentKeysMatch(approved, "claude-code|/project-a|credential-read|id_rsa"), false);
  assert.equal(handledIntentKeysMatch(approved, "codex|/project-a|credential-read|.env"), false);
});

test("only explicit prompt approvals are reusable by later pipeline stages", () => {
  assert.equal(isReusableHandledIntent({ eventName: "UserPromptSubmit", decision: "allow" }), false);
  assert.equal(isReusableHandledIntent({ eventName: "UserPromptSubmit", decision: "ask" }), true);
  assert.equal(isReusableHandledIntent({ eventName: "PreToolUse", decision: "allow" }), true);
});
