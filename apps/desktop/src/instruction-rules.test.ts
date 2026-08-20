import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverAgentInstructionFiles,
  ruleCandidatesFromMarkdown,
} from "./instruction-rules";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openleash-rules-"));
  const project = path.join(home, "code", "demo", "packages", "app");
  fs.mkdirSync(path.join(home, "code", "demo", ".git"), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return {
    home,
    project,
    write(relativePath: string, content = "Always run tests.\n") {
      const filePath = path.join(home, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
      return filePath;
    },
  };
}

test("instruction discovery follows agent-specific global and project conventions", (t) => {
  const value = fixture();
  t.after(() => fs.rmSync(value.home, { recursive: true, force: true }));
  value.write(".codex/AGENTS.md", "Ignored because override wins.");
  value.write(".codex/AGENTS.override.md", "Always use the override.");
  value.write(".claude/rules/security/nested.md");
  value.write(".openclaw/workspace/AGENTS.md");
  value.write(".gemini/settings.json", JSON.stringify({ context: { fileName: "TEAM.md" } }));
  value.write("code/demo/TEAM.md");
  value.write("code/demo/AGENTS.md");
  value.write("code/demo/packages/app/AGENTS.override.md");
  value.write("code/demo/packages/app/.cursor/rules/nested/typescript.mdc");
  value.write("code/demo/packages/app/.continue/rules/project.md");
  value.write("code/demo/packages/app/.github/instructions/frontend.instructions.md");
  value.write("code/demo/groups/CLAUDE.md");
  value.write("code/demo/groups/team/CLAUDE.md");

  const sources = discoverAgentInstructionFiles({
    home: value.home,
    codexHome: path.join(value.home, ".codex"),
    claudeConfigDir: path.join(value.home, ".claude"),
    platform: "darwin",
    projectPaths: [value.project],
  });
  const paths = sources.map((source) => source.path);

  assert.ok(paths.includes(path.join(value.home, ".codex", "AGENTS.override.md")));
  assert.ok(!paths.includes(path.join(value.home, ".codex", "AGENTS.md")));
  assert.ok(paths.includes(path.join(value.home, ".claude", "rules", "security", "nested.md")));
  assert.ok(paths.includes(path.join(value.home, ".openclaw", "workspace", "AGENTS.md")));
  assert.ok(paths.includes(path.join(value.home, "code", "demo", "TEAM.md")));
  assert.ok(paths.includes(path.join(value.project, "AGENTS.override.md")));
  assert.ok(paths.includes(path.join(value.project, ".cursor", "rules", "nested", "typescript.mdc")));
  assert.ok(paths.includes(path.join(value.project, ".continue", "rules", "project.md")));
  assert.ok(paths.includes(path.join(value.project, ".github", "instructions", "frontend.instructions.md")));
  assert.ok(paths.includes(path.join(value.home, "code", "demo", "groups", "CLAUDE.md")));
  assert.ok(paths.includes(path.join(value.home, "code", "demo", "groups", "team", "CLAUDE.md")));

  const shared = sources.find(
    (source) => source.path === path.join(value.home, "code", "demo", "AGENTS.md"),
  );
  assert.ok(shared?.agentKinds.includes("codex"));
  assert.ok(shared?.agentKinds.includes("cursor"));
});

test("markdown parsing ignores metadata and code blocks while keeping selectable rules", () => {
  const candidates = ruleCandidatesFromMarkdown([
    "---",
    "description: Project instructions",
    "---",
    "# Rules",
    "",
    "- Always run the focused tests.",
    "- Never print credentials.",
    "",
    "```sh",
    "echo this-is-an-example",
    "```",
  ].join("\n"));

  assert.deepEqual(candidates, [
    "Always run the focused tests.",
    "Never print credentials.",
  ]);
});
