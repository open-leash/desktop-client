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
  assert.equal(sessions[1]?.latestAction, "Updating a file");
});

test("shows the latest user request and explains tools in plain language", () => {
  const now = Date.parse("2026-07-20T10:00:00.000Z");
  const [session] = activeAgentSessions([{
    kind: "claude-code",
    display_name: "Claude Code",
    activity_at: new Date(now - 1_000).toISOString(),
    sessions: [{
      id: "claude",
      title: "quota",
      summary: "11 events · 2 approvals · 1 denied",
      last_activity_at: new Date(now - 1_000).toISOString(),
      events: [
        { event_name: "PreToolUse", tool_name: "Read", created_at: new Date(now - 1_000).toISOString() },
        { event_name: "UserPromptSubmit", prompt: "ok write a nice 2 page story about moses and god", created_at: new Date(now - 2_000).toISOString() },
      ],
    }],
  }], now);

  assert.equal(session?.title, "ok write a nice 2 page story about moses and god");
  assert.equal(session?.latestAction, "Reviewing project files");
  assert.equal(session?.summary, "11 actions · 2 approval requests · 1 blocked");
});

test("hides Claude control prompts and keeps the latest real user request", () => {
  const now = Date.parse("2026-07-20T10:00:00.000Z");
  const [session] = activeAgentSessions([{
    kind: "claude-code",
    display_name: "Claude Code",
    activity_at: new Date(now - 1_000).toISOString(),
    sessions: [{
      id: "claude-control-prompt",
      title: "[SYSTEM: internal fallback title]",
      last_activity_at: new Date(now - 1_000).toISOString(),
      events: [
        { event_name: "UserPromptSubmit", prompt: "[SUGGESTION MODE: Suggest what the user might naturally type next]", created_at: new Date(now - 1_000).toISOString() },
        { event_name: "UserPromptSubmit", prompt: "write the release notes", created_at: new Date(now - 2_000).toISOString() },
      ],
    }],
  }], now);

  assert.equal(session?.title, "write the release notes");
  assert.equal(session?.events[0]?.prompt, undefined);
  assert.equal(session?.events[1]?.prompt, "write the release notes");
});

test("uses a neutral title when a Claude session contains only control metadata", () => {
  const now = Date.parse("2026-07-20T10:00:00.000Z");
  const [session] = activeAgentSessions([{
    kind: "claude-code",
    display_name: "Claude Code",
    activity_at: new Date(now - 1_000).toISOString(),
    short_summary: "<system-reminder>Private provider instructions</system-reminder>",
    sessions: [{
      id: "claude-control-only",
      title: "<command-name>/internal</command-name>",
      last_activity_at: new Date(now - 1_000).toISOString(),
      events: [{ event_name: "UserPromptSubmit", prompt: "<system-reminder>Do not show this</system-reminder>" }],
    }],
  }], now);

  assert.equal(session?.title, "Agent working");
  assert.equal(session?.summary, "Agent is working");
});

test("removes transport session tags and merges duplicate hook and proxy views", () => {
  const now = Date.parse("2026-07-20T10:00:00.000Z");
  const sessions = activeAgentSessions([{
    kind: "claude-code",
    display_name: "Claude Code",
    sessions: [
      {
        id: "hook-session",
        session_id: "hook-session",
        project_path: "/code/MyProj",
        last_activity_at: new Date(now - 10_000).toISOString(),
        events: [{ event_name: "PreToolUse", tool_name: "Write", prompt: "write a short story to story.txt" }],
      },
      {
        id: "proxy-session",
        session_id: "proxy-session",
        project_path: undefined,
        last_activity_at: new Date(now - 20_000).toISOString(),
        events: [{ event_name: "UserPromptSubmit", prompt: "<session>write a short story to story.txt</session> Workspace metadata" }],
      },
    ],
  }], now);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.title, "write a short story to story.txt");
  assert.deepEqual(sessions[0]?.sourceSessionIds.sort(), ["hook-session", "proxy-session"]);
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
  assert.deepEqual(ambientIslandContributions(contributions, ["session-1"]).map((item) => item.id), ["three"]);
  assert.deepEqual(ambientIslandContributions(contributions, ["other-session"]).map((item) => item.id), ["one", "two", "three"]);
});
