import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type InstructionRuleSource = {
  agent: string;
  agentKinds: string[];
  scope: "global" | "project";
  label: string;
  path: string;
};

type DiscoveryOptions = {
  home?: string;
  platform?: NodeJS.Platform;
  appData?: string;
  codexHome?: string;
  claudeConfigDir?: string;
  projectPaths?: string[];
};

const instructionFilePattern =
  /\.(?:md|markdown|mdc|txt|rules)$/i;
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "vendor",
]);

export function discoverAgentInstructionFiles(
  options: DiscoveryOptions = {},
): InstructionRuleSource[] {
  const home = options.home ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const appData =
    options.appData ??
    process.env.APPDATA ??
    path.join(home, "AppData", "Roaming");
  const codexHome =
    options.codexHome ?? process.env.CODEX_HOME ?? path.join(home, ".codex");
  const claudeConfigDir =
    options.claudeConfigDir ??
    process.env.CLAUDE_CONFIG_DIR ??
    path.join(home, ".claude");
  const sources: InstructionRuleSource[] = [];
  const add = (
    agent: string,
    agentKinds: string[],
    scope: "global" | "project",
    label: string,
    filePath: string,
  ) => {
    if (!filePath || !safeIsFile(filePath)) return;
    sources.push({
      agent,
      agentKinds,
      scope,
      label,
      path: path.resolve(filePath),
    });
  };
  const addDirectory = (
    agent: string,
    agentKinds: string[],
    scope: "global" | "project",
    label: string,
    directory: string,
    pattern = instructionFilePattern,
  ) => {
    for (const filePath of filesRecursively(directory, pattern)) {
      add(agent, agentKinds, scope, label, filePath);
    }
  };

  add(
    "Claude Code",
    ["claude-code"],
    "global",
    "Global CLAUDE.md",
    path.join(claudeConfigDir, "CLAUDE.md"),
  );
  const globalOpenCodeAgents = path.join(
    platform === "win32" ? appData : path.join(home, ".config"),
    "opencode",
    "AGENTS.md",
  );
  if (!safeIsNonEmptyFile(globalOpenCodeAgents)) {
    add(
      "OpenCode",
      ["opencode"],
      "global",
      "OpenCode CLAUDE.md fallback",
      path.join(claudeConfigDir, "CLAUDE.md"),
    );
  }
  addDirectory(
    "Claude Code",
    ["claude-code"],
    "global",
    "Global Claude rule",
    path.join(claudeConfigDir, "rules"),
  );
  addFirstExisting(
    add,
    "OpenAI Codex",
    ["codex"],
    "global",
    "Global Codex instructions",
    [
      path.join(codexHome, "AGENTS.override.md"),
      path.join(codexHome, "AGENTS.md"),
    ],
  );
  add(
    "Gemini CLI",
    ["gemini"],
    "global",
    "Global Gemini instructions",
    path.join(home, ".gemini", "GEMINI.md"),
  );
  add(
    "OpenCode",
    ["opencode"],
    "global",
    "Global AGENTS.md",
    globalOpenCodeAgents,
  );
  add(
    "Windsurf",
    ["windsurf"],
    "global",
    "Global Windsurf rules",
    path.join(
      home,
      ".codeium",
      "windsurf",
      "memories",
      "global_rules.md",
    ),
  );
  add(
    "GitHub Copilot",
    ["github-copilot"],
    "global",
    "Copilot CLI instructions",
    path.join(home, ".copilot", "copilot-instructions.md"),
  );
  addDirectory(
    "GitHub Copilot",
    ["github-copilot"],
    "global",
    "Path-specific Copilot instruction",
    path.join(home, ".copilot", "instructions"),
    /\.instructions\.md$/i,
  );
  for (const workspace of openClawWorkspaces(home)) {
    add(
      "OpenClaw",
      ["openclaw"],
      "global",
      "OpenClaw workspace AGENTS.md",
      path.join(workspace, "AGENTS.md"),
    );
  }

  const clineGlobalRoots =
    platform === "win32"
      ? [path.join(home, "Documents", "Cline", "Rules")]
      : [
          path.join(home, "Documents", "Cline", "Rules"),
          path.join(home, "Cline", "Rules"),
        ];
  for (const root of clineGlobalRoots) {
    addDirectory("Cline", ["cline"], "global", "Global Cline rule", root);
  }

  const geminiFileNames = geminiContextFileNames(
    path.join(home, ".gemini", "settings.json"),
  );
  for (const projectPath of options.projectPaths ?? []) {
    for (const base of projectInstructionBases(projectPath)) {
      add(
        "Claude Code / Cursor",
        ["claude-code", "cursor"],
        "project",
        "Project CLAUDE.md",
        path.join(base, "CLAUDE.md"),
      );
      if (
        !safeIsNonEmptyFile(path.join(base, "AGENTS.override.md")) &&
        !safeIsNonEmptyFile(path.join(base, "AGENTS.md"))
      ) {
        add(
          "OpenCode",
          ["opencode"],
          "project",
          "OpenCode CLAUDE.md fallback",
          path.join(base, "CLAUDE.md"),
        );
      }
      add(
        "Claude Code",
        ["claude-code"],
        "project",
        "Local CLAUDE.local.md",
        path.join(base, "CLAUDE.local.md"),
      );
      add(
        "Claude Code",
        ["claude-code"],
        "project",
        "Project .claude/CLAUDE.md",
        path.join(base, ".claude", "CLAUDE.md"),
      );
      addDirectory(
        "Claude Code",
        ["claude-code"],
        "project",
        "Project Claude rule",
        path.join(base, ".claude", "rules"),
      );
      addFirstExisting(
        add,
        "OpenAI Codex",
        ["codex"],
        "project",
        "Project Codex instructions",
        [
          path.join(base, "AGENTS.override.md"),
          path.join(base, "AGENTS.md"),
        ],
      );
      for (const fileName of geminiFileNames) {
        add(
          "Gemini CLI",
          ["gemini"],
          "project",
          "Project Gemini instructions",
          path.join(base, fileName),
        );
      }
      add(
        "Cursor / Cline / OpenCode / Windsurf / Copilot",
        ["cursor", "cline", "opencode", "windsurf", "github-copilot"],
        "project",
        "Shared AGENTS.md",
        path.join(base, "AGENTS.md"),
      );
      add(
        "Cursor",
        ["cursor"],
        "project",
        "Legacy .cursorrules",
        path.join(base, ".cursorrules"),
      );
      addDirectory(
        "Cursor",
        ["cursor"],
        "project",
        "Cursor rule",
        path.join(base, ".cursor", "rules"),
      );
      addDirectory(
        "Continue",
        ["continue"],
        "project",
        "Continue rule",
        path.join(base, ".continue", "rules"),
        /\.(?:md|markdown|txt|ya?ml)$/i,
      );
      add(
        "Cline",
        ["cline"],
        "project",
        "Legacy .clinerules",
        path.join(base, ".clinerules"),
      );
      addDirectory(
        "Cline",
        ["cline"],
        "project",
        "Cline rule",
        path.join(base, ".clinerules"),
      );
      add(
        "Windsurf",
        ["windsurf"],
        "project",
        "Legacy .windsurfrules",
        path.join(base, ".windsurfrules"),
      );
      addDirectory(
        "Windsurf",
        ["windsurf"],
        "project",
        "Windsurf rule",
        path.join(base, ".windsurf", "rules"),
      );
      add(
        "GitHub Copilot",
        ["github-copilot"],
        "project",
        "Copilot instructions",
        path.join(base, ".github", "copilot-instructions.md"),
      );
      addDirectory(
        "GitHub Copilot",
        ["github-copilot"],
        "project",
        "Path-specific Copilot instruction",
        path.join(base, ".github", "instructions"),
        /\.instructions\.md$/i,
      );
      addOpenCodeInstructionFiles(base, add);
      add(
        "NanoClaw",
        ["nanoclaw"],
        "project",
        "NanoClaw global CLAUDE.md",
        path.join(base, "groups", "CLAUDE.md"),
      );
      for (const filePath of filesRecursively(
        path.join(base, "groups"),
        /CLAUDE\.md$/i,
      )) {
        if (path.dirname(filePath) === path.join(base, "groups")) continue;
        add(
          "NanoClaw",
          ["nanoclaw"],
          "project",
          "NanoClaw group CLAUDE.md",
          filePath,
        );
      }
    }
  }

  return mergeSources(sources);
}

export function ruleCandidatesFromMarkdown(content: string) {
  const cleaned = content
    .replace(/^---\n[\s\S]*?\n---\n?/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\r\n/g, "\n");
  const candidates: string[] = [];
  for (const paragraph of cleaned.split(/\n{2,}/g)) {
    const lines = paragraph
      .split(/\n/g)
      .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const listItems = lines
      .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line))
      .map((line) =>
        line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim(),
      )
      .filter(isRuleCandidateText);
    if (listItems.length > 0) {
      candidates.push(...listItems);
      continue;
    }
    const text = lines.join(" ").replace(/\s+/g, " ").trim();
    if (isRuleCandidateText(text)) candidates.push(text);
  }
  return [
    ...new Map(candidates.map((text) => [text.toLowerCase(), text])).values(),
  ];
}

function isRuleCandidateText(text: string) {
  return (
    text.length >= 8 &&
    !/^(rules|instructions|guidelines|notes?|overview|context|examples?)[:.]?$/i.test(
      text,
    )
  );
}

function addFirstExisting(
  add: (
    agent: string,
    agentKinds: string[],
    scope: "global" | "project",
    label: string,
    filePath: string,
  ) => void,
  agent: string,
  agentKinds: string[],
  scope: "global" | "project",
  label: string,
  candidates: string[],
) {
  const selected = candidates.find((candidate) => safeIsNonEmptyFile(candidate));
  if (selected) add(agent, agentKinds, scope, label, selected);
}

function projectInstructionBases(projectPath: string) {
  let current = path.resolve(projectPath);
  if (!safeIsDirectory(current)) current = path.dirname(current);
  const gitRoot = nearestGitRoot(current) ?? current;
  const bases: string[] = [];
  while (current.startsWith(gitRoot)) {
    bases.push(current);
    if (current === gitRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return bases.reverse();
}

function nearestGitRoot(start: string) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function filesRecursively(
  directory: string,
  pattern: RegExp,
  maxFiles = 200,
) {
  const files: string[] = [];
  const visit = (current: string, depth: number) => {
    if (depth > 8 || files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const filePath = path.join(current, entry.name);
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !ignoredDirectories.has(entry.name)
      ) {
        visit(filePath, depth + 1);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        files.push(filePath);
      }
    }
  };
  visit(directory, 0);
  return files.sort();
}

function geminiContextFileNames(settingsPath: string) {
  const defaults = ["GEMINI.md"];
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      context?: { fileName?: unknown };
    };
    const configured = Array.isArray(settings.context?.fileName)
      ? settings.context?.fileName
      : [settings.context?.fileName];
    const names = configured
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(
        (value) =>
          value.length > 0 &&
          !path.isAbsolute(value) &&
          !value.split(/[\\/]/).includes(".."),
      );
    return names.length > 0 ? [...new Set(names)] : defaults;
  } catch {
    return defaults;
  }
}

function addOpenCodeInstructionFiles(
  base: string,
  add: (
    agent: string,
    agentKinds: string[],
    scope: "global" | "project",
    label: string,
    filePath: string,
  ) => void,
) {
  for (const configName of ["opencode.json", "opencode.jsonc"]) {
    const configPath = path.join(base, configName);
    let raw = "";
    try {
      raw = fs.readFileSync(configPath, "utf8");
      if (configName.endsWith(".jsonc")) {
        raw = raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
      }
      const config = JSON.parse(raw) as { instructions?: unknown };
      if (!Array.isArray(config.instructions)) continue;
      for (const instruction of config.instructions) {
        if (
          typeof instruction !== "string" ||
          /^https?:\/\//i.test(instruction) ||
          /[*?[\]{}]/.test(instruction)
        ) {
          continue;
        }
        const filePath = path.resolve(base, instruction);
        if (!filePath.startsWith(`${path.resolve(base)}${path.sep}`)) continue;
        add(
          "OpenCode",
          ["opencode"],
          "project",
          "Configured OpenCode instruction",
          filePath,
        );
      }
    } catch {
      continue;
    }
  }
}

function openClawWorkspaces(home: string) {
  const roots = new Set<string>();
  const profile = String(process.env.OPENCLAW_PROFILE ?? "").trim();
  roots.add(
    path.join(
      home,
      ".openclaw",
      profile && profile !== "default" ? `workspace-${profile}` : "workspace",
    ),
  );
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(home, ".openclaw", "openclaw.json"), "utf8"),
    ) as {
      agents?: {
        defaults?: { workspace?: unknown };
        list?: Array<{ workspace?: unknown }>;
      };
    };
    const configured = [
      config.agents?.defaults?.workspace,
      ...(config.agents?.list ?? []).map((agent) => agent.workspace),
    ];
    for (const value of configured) {
      if (typeof value !== "string" || !value.trim()) continue;
      roots.add(expandHomePath(value.trim(), home));
    }
  } catch {
    // The documented default remains valid when no readable config exists.
  }
  return [...roots].map((root) => path.resolve(root));
}

function expandHomePath(value: string, home: string) {
  if (value === "~") return home;
  if (value.startsWith(`~${path.sep}`)) return path.join(home, value.slice(2));
  return value;
}

function mergeSources(sources: InstructionRuleSource[]) {
  const byPath = new Map<string, InstructionRuleSource>();
  for (const source of sources) {
    const existing = byPath.get(source.path);
    if (!existing) {
      byPath.set(source.path, source);
      continue;
    }
    existing.agentKinds = [
      ...new Set([...existing.agentKinds, ...source.agentKinds]),
    ];
    if (!existing.agent.includes(source.agent)) {
      existing.agent = `${existing.agent} / ${source.agent}`;
    }
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function safeIsFile(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeIsDirectory(filePath: string) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function safeIsNonEmptyFile(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}
