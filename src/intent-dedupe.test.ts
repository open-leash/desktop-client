import assert from "node:assert/strict";
import test from "node:test";
import {
  handledIntentKeysMatch,
  isReusableHandledIntent,
  pendingIntentKey,
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

test("local pending prompt copies dedupe despite session tags and different summaries", () => {
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

test("local database destruction prompt variants share one pending notice", () => {
  assert.equal(
    pendingIntentKey({ agentKind: "claude-code", projectPath: "/project", prompt: "delete all tables in my sqlite database" }),
    pendingIntentKey({ agentKind: "claude-code", projectPath: "/project", prompt: "delete my tables in sqlite file here" }),
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
