import os from "node:os";
import path from "node:path";

export const home = os.homedir();
export const openLeashDir = path.join(home, ".openleash");
export const openLeashConfigPath = path.join(openLeashDir, "config.json");
export const claudeSettingsPath = path.join(home, ".claude", "settings.json");
export const codexConfigPath = path.join(home, ".codex", "config.toml");
export const codexHooksPath = path.join(home, ".codex", "hooks.json");
export const geminiSettingsPath = path.join(home, ".gemini", "settings.json");
export const cursorHooksPath = path.join(home, ".cursor", "hooks.json");
export const copilotHooksDir = path.join(process.env.COPILOT_HOME || path.join(home, ".copilot"), "hooks");
export const copilotOpenLeashHooksPath = path.join(copilotHooksDir, "openleash.json");
export const openCodePluginPath = path.join(home, ".config", "opencode", "plugins", "openleash.js");
export const openClawConfigPath = path.join(home, ".openclaw", "config.json");
export const openClawHooksDir = path.join(home, ".openclaw", "hooks");
export const openClawOpenLeashHookDir = path.join(openClawHooksDir, "openleash");
export const nanoClawSettingsPath = path.join(home, ".nanoclaw", "settings.json");
