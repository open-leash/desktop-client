import fs from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  claudeSettingsPath,
  codexConfigPath,
  cursorHooksPath,
  geminiSettingsPath,
  nanoClawSettingsPath,
  openClawConfigPath,
  openClawOpenLeashHookDir,
  openCodePluginPath
} from "./paths.js";

export type DiscoveredAgent = {
  kind: "claude-code" | "codex" | "gemini" | "opencode" | "cursor" | "openclaw" | "nanoclaw";
  displayName: string;
  configPath: string;
  installed: boolean;
  executablePath?: string;
};

export async function discoverAgents(): Promise<DiscoveredAgent[]> {
  const [claudeExists, codexExists, geminiExists, openCodeExists, cursorExists, openClawExists, openClawHookExists, nanoClawExists] = await Promise.all([
    exists(claudeSettingsPath),
    exists(codexConfigPath),
    exists(geminiSettingsPath),
    exists(openCodePluginPath),
    exists(cursorHooksPath),
    exists(openClawConfigPath),
    exists(openClawOpenLeashHookDir),
    exists(nanoClawSettingsPath)
  ]);
  return [
    {
      kind: "claude-code",
      displayName: "Claude Code",
      configPath: claudeSettingsPath,
      installed: claudeExists || Boolean(findOnPath("claude")),
      executablePath: findOnPath("claude")
    },
    {
      kind: "codex",
      displayName: "OpenAI Codex",
      configPath: codexConfigPath,
      installed: codexExists || Boolean(findOnPath("codex")),
      executablePath: findOnPath("codex")
    },
    {
      kind: "gemini",
      displayName: "Google Gemini CLI",
      configPath: geminiSettingsPath,
      installed: geminiExists || Boolean(findOnPath("gemini")),
      executablePath: findOnPath("gemini")
    },
    {
      kind: "opencode",
      displayName: "OpenCode",
      configPath: openCodePluginPath,
      installed: openCodeExists || Boolean(findOnPath("opencode")),
      executablePath: findOnPath("opencode")
    },
    {
      kind: "cursor",
      displayName: "Cursor",
      configPath: cursorHooksPath,
      installed: cursorExists || pathExists("/Applications/Cursor.app"),
      executablePath: undefined
    },
    {
      kind: "openclaw",
      displayName: "OpenClaw",
      configPath: openClawConfigPath,
      installed: openClawExists || openClawHookExists || Boolean(findOnPath("openclaw")),
      executablePath: findOnPath("openclaw")
    },
    {
      kind: "nanoclaw",
      displayName: "NanoClaw",
      configPath: nanoClawSettingsPath,
      installed: nanoClawExists || Boolean(findOnPath("nanoclaw")) || pathExists("/Applications/NanoClaw.app"),
      executablePath: findOnPath("nanoclaw")
    }
  ];
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(binary: string) {
  const suffixes = os.platform() === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, `${binary}${suffix}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function pathExists(value: string) {
  try {
    accessSync(value);
    return true;
  } catch {
    return false;
  }
}
