import assert from "node:assert/strict";
import test from "node:test";
import {
  detectIdeHostFromProcessTree,
  macIdeOpenActions,
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

test("detects Codex hosted by the VS Code extension instead of treating it as a terminal agent", () => {
  const tree = `
  64108 1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
  64565 64108 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)
  64721 64565 /Users/max/.vscode/extensions/openai.chatgpt/bin/codex app-server
  `;
  assert.equal(detectIdeHostFromProcessTree(tree, { agentKind: "codex" }), "Visual Studio Code");
  assert.equal(detectIdeHostFromProcessTree(tree, { agentKind: "codex" }, 64721), "Visual Studio Code");
});

test("does not mistake a standalone terminal Codex process for an IDE session", () => {
  const tree = `
  100 1 /Applications/Terminal.app/Contents/MacOS/Terminal
  101 100 /bin/zsh
  102 101 /opt/homebrew/bin/codex
  `;
  assert.equal(detectIdeHostFromProcessTree(tree, { agentKind: "codex" }, 102), undefined);
});

test("macOS reuses the existing VS Code project and opens the exact Codex conversation", () => {
  assert.deepEqual(
    macIdeOpenActions("Visual Studio Code", {
      agentKind: "codex",
      projectPath: "/Users/max/Code/FileMesh (All)",
      sessionId: "019fb4c2-7954-7c30-87c0-c833911c6d44",
    }),
    [
      {
        command: "/usr/bin/open",
        args: ["vscode://file/Users/max/Code/FileMesh%20(All)"],
      },
      {
        command: "/usr/bin/open",
        args: [
          "vscode://openai.chatgpt/local/019fb4c2-7954-7c30-87c0-c833911c6d44",
        ],
        delayMs: 650,
      },
    ],
  );
});

test("macOS does not route non-Codex or non-UUID sessions through the Codex extension", () => {
  assert.deepEqual(
    macIdeOpenActions("Cursor", {
      agentKind: "cursor",
      projectPath: "/Users/max/Code/OpenLeash",
      sessionId: "cursor-session",
    }),
    [
      {
        command: "/usr/bin/open",
        args: ["cursor://file/Users/max/Code/OpenLeash"],
      },
    ],
  );
  assert.deepEqual(
    macIdeOpenActions("Visual Studio Code", {
      agentKind: "codex",
      projectPath: "/Users/max/Code/OpenLeash",
      sessionId: "not-a-codex-thread-id",
    }),
    [
      {
        command: "/usr/bin/open",
        args: ["vscode://file/Users/max/Code/OpenLeash"],
      },
    ],
  );
});

test("smart suppression keeps the island collapsed only when the target is frontmost", () => {
  assert.equal(shouldAutoExpandAttention(true), false);
  assert.equal(shouldAutoExpandAttention(false), true);
});

test("matches the exact Windows terminal project instead of any terminal", () => {
  const target = {
    agentKind: "claude-code",
    projectPath: "C:\\Users\\Max\\Code\\OpenLeash",
    project: "Leash",
  };
  assert.equal(matchesWindowsFrontmost({ processName: "WindowsTerminal", windowTitle: "Claude - OpenLeash" }, target), true);
  assert.equal(matchesWindowsFrontmost({ processName: "WindowsTerminal", windowTitle: "PowerShell - OtherProject" }, target), false);
});

test("requires the expected Windows IDE process as well as the project title", () => {
  const target = { agentKind: "cursor", projectPath: "C:\\Code\\Leash" };
  assert.equal(matchesWindowsFrontmost({ processName: "Cursor", windowTitle: "Leash - Cursor" }, target), true);
  assert.equal(matchesWindowsFrontmost({ processName: "Code", windowTitle: "Leash - Visual Studio Code" }, target), false);
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
