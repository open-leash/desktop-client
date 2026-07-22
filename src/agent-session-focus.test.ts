import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesWindowsFrontmost,
  parseProcessTable,
  rankAgentProcesses,
  shouldAutoExpandAttention,
  windowsFocusScript,
} from "./agent-session-focus";

test("parses attached agent processes and ignores headless rows", () => {
  const rows = parseProcessTable(`
  120 ttys003 /opt/homebrew/bin/claude
  121 ?? /opt/homebrew/bin/codex
  122 ttys008 node /usr/local/bin/codex
  `);
  assert.deepEqual(rows.map(({ pid, tty }) => ({ pid, tty })), [
    { pid: 120, tty: "/dev/ttys003" },
    { pid: 122, tty: "/dev/ttys008" },
  ]);
});

test("ranks an exact transcript and project match ahead of another agent process", () => {
  const ranked = rankAgentProcesses([
    { pid: 20, tty: "/dev/ttys002", command: "codex", cwd: "/code/other" },
    { pid: 10, tty: "/dev/ttys001", command: "codex", cwd: "/code/openleash", openFiles: "/sessions/session-42.jsonl" },
  ], {
    agentKind: "codex",
    projectPath: "/code/openleash",
    sessionId: "session-42",
  });
  assert.equal(ranked[0]?.pid, 10);
});

test("smart suppression keeps the island collapsed only when the target is frontmost", () => {
  assert.equal(shouldAutoExpandAttention(true), false);
  assert.equal(shouldAutoExpandAttention(false), true);
});

test("matches the exact Windows terminal project instead of any terminal", () => {
  const target = {
    agentKind: "claude-code",
    projectPath: "C:\\Users\\Max\\Code\\OpenLeash",
    project: "OpenLeash",
  };
  assert.equal(matchesWindowsFrontmost({ processName: "WindowsTerminal", windowTitle: "Claude - OpenLeash" }, target), true);
  assert.equal(matchesWindowsFrontmost({ processName: "WindowsTerminal", windowTitle: "PowerShell - OtherProject" }, target), false);
});

test("requires the expected Windows IDE process as well as the project title", () => {
  const target = { agentKind: "cursor", projectPath: "C:\\Code\\OpenLeash" };
  assert.equal(matchesWindowsFrontmost({ processName: "Cursor", windowTitle: "OpenLeash - Cursor" }, target), true);
  assert.equal(matchesWindowsFrontmost({ processName: "Code", windowTitle: "OpenLeash - Visual Studio Code" }, target), false);
});

test("Windows focus script safely quotes paths and can launch the exact project", () => {
  const script = windowsFocusScript({
    agentKind: "codex",
    projectPath: "C:\\Users\\Max's PC\\Code\\OpenLeash",
    title: "Codex",
  });
  assert.match(script, /Max''s PC/);
  assert.match(script, /WriteLine\('exact'\)/);
  assert.match(script, /Get-Command 'wt\.exe'/);
  assert.match(script, /@\('-d', \$projectPath\)/);
});

test("Windows IDE focus script launches the matching editor command", () => {
  const script = windowsFocusScript({ agentKind: "windsurf", projectPath: "C:\\Code\\OpenLeash" });
  assert.match(script, /windsurf\.exe/);
  assert.match(script, /--reuse-window/);
});
