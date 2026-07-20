import assert from "node:assert/strict";
import test from "node:test";
import {
  activeAgentSessions,
  activityIslandKey,
  ambientIslandContributions,
  contributionsForSession,
} from "./activity-island";
import type { PluginIslandContribution } from "@openleash/shared";

const supportedAgents = [
  "claude-code", "codex", "gemini", "cursor", "opencode", "github-copilot",
  "cline", "continue", "windsurf", "openclaw", "nanoclaw",
];

test("builds active island sessions consistently across supported coding agents", () => {
  const now = Date.parse("2026-07-20T10:00:00.000Z");
  const sessions = activeAgentSessions(supportedAgents.map((kind, index) => ({
    kind,
    display_name: kind,
    hostname: "mac",
    event_name: index % 2 ? "PreToolUse" : "UserPromptSubmit",
    tool_name: index % 2 ? "Edit" : undefined,
    project_path: `/code/project-${index}`,
    activity_at: new Date(now - index * 1_000).toISOString(),
    short_summary: `Task ${index}`,
  })), now);

  assert.equal(sessions.length, supportedAgents.length);
  assert.deepEqual(new Set(sessions.map((session) => session.agentKind)), new Set(supportedAgents));
  assert.equal(sessions[0]?.latestAction, "Reading your request");
  assert.equal(sessions[1]?.latestAction, "Edit");
});

test("excludes completed and stale sessions and keeps the key stable across updates", () => {
  const now = Date.parse("2026-07-20T10:00:00.000Z");
  const agents = [{
    kind: "claude-code",
    display_name: "Claude Code",
    hostname: "mac",
    sessions: [
      { id: "active", title: "Ship feature", last_activity_at: new Date(now - 10_000).toISOString(), events: [{ event_name: "PreToolUse", tool_name: "Bash" }] },
      { id: "done", title: "Done", last_activity_at: new Date(now - 2_000).toISOString(), events: [{ event_name: "Stop" }] },
      { id: "stale", title: "Old", last_activity_at: new Date(now - 180_000).toISOString(), events: [{ event_name: "PreToolUse" }] },
    ],
  }];
  const first = activeAgentSessions(agents, now);
  const updated = activeAgentSessions([{ ...agents[0], sessions: [{ ...agents[0].sessions[0], event_count: 4 }] }], now);

  assert.deepEqual(first.map((session) => session.id), ["active"]);
  assert.equal(activityIslandKey(first), activityIslandKey(updated));
});

test("attaches plugin annotations and related global status to the intended session", () => {
  const base = {
    schemaVersion: "2026-07-20.plugin-island.v1" as const,
    pluginId: "community.test-progress",
    updatedAt: "2026-07-20T10:00:00.000Z",
    expiresAt: "2026-07-20T10:02:00.000Z",
    tone: "info" as const,
  };
  const contributions: PluginIslandContribution[] = [
    { ...base, id: "one", key: "risk", kind: "annotation", sessionId: "session-1", label: "Risk", value: "high" },
    { ...base, id: "two", key: "tests", kind: "status", title: "Tests running", relatedSessionIds: ["session-1"] },
    { ...base, id: "three", key: "release", kind: "status", title: "Release ready", relatedSessionIds: [] },
  ];

  assert.deepEqual(contributionsForSession(contributions, "session-1").map((item) => item.id), ["one", "two"]);
  assert.deepEqual(ambientIslandContributions(contributions).map((item) => item.id), ["two", "three"]);
});
