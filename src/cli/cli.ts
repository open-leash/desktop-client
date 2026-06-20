#!/usr/bin/env node
import { Command } from "commander";
import os from "node:os";
import { apiVersionHeaders } from "./api-contract.js";
import { defaultCloudApiUrl, defaultDesktopApiUrl, readConfig, writeConfig } from "./config.js";
import { discoverAgents } from "./discovery.js";
import {
  installClaudeHooks,
  installCodexHooks,
  installCursorHooks,
  installGeminiHooks,
  installNanoClawHooks,
  installOpenCodeHooks,
  installOpenClawHooks,
  uninstallClaudeHooks,
  uninstallCodexHooks,
  uninstallCursorHooks,
  uninstallGeminiHooks,
  uninstallNanoClawHooks,
  uninstallOpenCodeHooks,
  uninstallOpenClawHooks
} from "./install.js";
import { runHook } from "./hook.js";

const program = new Command();

program.name("openleash").description("OpenLeash Desktop Client CLI and hook installer");

program
  .command("configure")
  .requiredOption("--token <token>", "OpenLeash user token")
  .option("--api-url <url>", "OpenLeash local desktop API URL", defaultDesktopApiUrl)
  .option("--mode <mode>", "community, cloud, or enterprise", "community")
  .option("--email <email>", "User email")
  .option("--display-name <name>", "Display name")
  .action(async (options) => {
    await writeConfig({
      token: options.token,
      apiUrl: options.apiUrl,
      mode: options.mode,
      enrolledAt: new Date().toISOString(),
      clientVersion: "0.1.0",
      user: options.email || options.displayName ? { email: options.email, displayName: options.displayName } : undefined,
      computer: { hostname: os.hostname() }
    });
    console.log("OpenLeash Client config saved.");
  });

program
  .command("enroll")
  .requiredOption("--tenant <host>", "OpenLeash tenant host, for example openleash.company.com")
  .requiredOption("--token <token>", "OpenLeash deployment token")
  .option("--api-url <url>", "OpenLeash API URL. Defaults to https://<tenant>")
  .option("--email <email>", "User email for unmanaged enrollment")
  .option("--display-name <name>", "Display name for unmanaged enrollment")
  .option("--mode <mode>", "cloud or enterprise", "cloud")
  .action(async (options) => {
    const apiUrl = options.apiUrl ?? tenantToApiUrl(options.tenant);
    const response = await fetch(`${apiUrl}/v1/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json", ...apiVersionHeaders("tenantEnroll") },
      body: JSON.stringify({
        deploymentToken: options.token,
        email: options.email,
        displayName: options.displayName ?? os.userInfo().username,
        hostname: os.hostname(),
        platform: os.platform(),
        osRelease: os.release(),
        mode: options.mode
      })
    });
    const body = await response.json();
    if (!response.ok) {
      console.error(`OpenLeash enrollment failed: ${body.error ?? response.statusText}`);
      process.exitCode = 1;
      return;
    }
    await writeConfig({
      apiUrl: defaultDesktopApiUrl,
      token: body.token,
      mode: body.mode === "enterprise" || body.mode === "private" ? "enterprise" : "cloud",
      tenantUrl: body.tenantUrl ?? options.tenant,
      remoteApiUrl: body.apiUrl ?? apiUrl,
      enrolledAt: new Date().toISOString(),
      clientVersion: "0.1.0",
      user: body.user ? { email: body.user.email, displayName: body.user.display_name } : undefined,
      computer: body.computer
    });
    console.log(`OpenLeash Client enrolled ${os.hostname()} with ${body.tenantUrl ?? options.tenant}.`);
  });

program.command("discover").action(async () => {
  console.table(await discoverAgents());
});

program
  .command("install-hooks")
  .option("--claude", "install Claude Code hooks")
  .option("--codex", "install Codex hooks")
  .option("--gemini", "install Gemini CLI hooks")
  .option("--opencode", "install OpenCode hooks")
  .option("--cursor", "install Cursor hooks")
  .option("--openclaw", "install OpenClaw hooks")
  .option("--nanoclaw", "install NanoClaw hooks")
  .option("--all", "install every production-ready hook", true)
  .action(async (options) => {
    if (options.all || options.claude) await installClaudeHooks();
    if (options.all || options.codex) await installCodexHooks();
    if (options.all || options.gemini) await installGeminiHooks();
    if (options.all || options.opencode) await installOpenCodeHooks();
    if (options.all || options.cursor) await installCursorHooks();
    if (options.all || options.openclaw) await installOpenClawHooks();
    if (options.all || options.nanoclaw) await installNanoClawHooks();
    console.log("OpenLeash hooks installed.");
  });

program
  .command("uninstall-hooks")
  .option("--claude", "remove Claude Code hooks")
  .option("--codex", "remove Codex hooks")
  .option("--gemini", "remove Gemini CLI hooks")
  .option("--opencode", "remove OpenCode hooks")
  .option("--cursor", "remove Cursor hooks")
  .option("--openclaw", "remove OpenClaw hooks")
  .option("--nanoclaw", "remove NanoClaw hooks")
  .option("--all", "remove every reversible hook", true)
  .action(async (options) => {
    if (options.all || options.claude) await uninstallClaudeHooks();
    if (options.all || options.codex) await uninstallCodexHooks();
    if (options.all || options.gemini) await uninstallGeminiHooks();
    if (options.all || options.opencode) await uninstallOpenCodeHooks();
    if (options.all || options.cursor) await uninstallCursorHooks();
    if (options.all || options.openclaw) await uninstallOpenClawHooks();
    if (options.all || options.nanoclaw) await uninstallNanoClawHooks();
    console.log("OpenLeash hooks removed.");
  });

program
  .command("hook")
  .requiredOption("--agent <agent>", "claude, codex, gemini, opencode, cursor, openclaw, or nanoclaw")
  .requiredOption("--event <event>", "hook event name")
  .action(async (options) => {
    await runHook(options.agent, options.event);
  });

program.command("desktop").action(() => {
  console.log("Run `npm run desktop-client` from the OpenLeash repo to start the desktop app.");
});

program.command("status").action(async () => {
  try {
    const config = await readConfig();
    const response = await fetch(`${config.apiUrl}/health`, { headers: apiVersionHeaders("health") }).catch(() => undefined);
    console.table({
      mode: config.mode ?? "cloud",
      apiUrl: config.apiUrl,
      tenantUrl: config.tenantUrl ?? "",
      enrolledAt: config.enrolledAt ?? "",
      user: config.user?.email ?? "",
      computer: config.computer?.hostname ?? os.hostname(),
      apiReachable: response?.ok ? "yes" : "no"
    });
  } catch (error) {
    console.error(`OpenLeash is not configured: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
});

program
  .command("update")
  .option("--yes", "install without prompting when supported")
  .action(async (options) => {
    const args = ["-a", "OpenLeash", "--args", "--update"];
    if (options.yes) args.push("--yes");
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("open", args, { stdio: "inherit" });
    if (result.error || result.status !== 0) {
      console.log("OpenLeash updater is available from the tray app. On Windows, run OpenLeash.exe --update.");
      if (result.status) process.exitCode = result.status;
    }
  });

void program.parseAsync();

function tenantToApiUrl(tenant: string) {
  if (/^https?:\/\//i.test(tenant)) return tenant.replace(/\/+$/, "");
  return `https://${tenant.replace(/\/+$/, "")}`;
}
