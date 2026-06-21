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

type PluginListing = {
  id: string;
  slug?: string;
  name?: string;
  developerName?: string;
  reviewStatus?: string;
  rating?: number;
  installCount?: number;
  downloadCount?: number;
  weeklyDownloadCount?: number;
  trendPercent?: number;
  installed?: boolean;
  mandatory?: boolean;
  installable?: boolean;
};

program.name("openleash").description("OpenLeash Desktop Client CLI and hook installer");

program
  .command("configure")
  .requiredOption("--token <token>", "OpenLeash user token")
  .option("--api-url <url>", "OpenLeash local desktop API URL", defaultDesktopApiUrl)
  .option("--remote-api-url <url>", "OpenLeash Cloud or Private Cloud client API URL")
  .option("--mode <mode>", "community, cloud, or enterprise", "community")
  .option("--email <email>", "User email")
  .option("--display-name <name>", "Display name")
  .action(async (options) => {
    await writeConfig({
      token: options.token,
      apiUrl: options.apiUrl,
      remoteApiUrl: options.remoteApiUrl,
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
  .option("--all", "install every production-ready hook")
  .action(async (options) => {
    const all = options.all || noHookAgentSelected(options);
    if (all || options.claude) await installClaudeHooks();
    if (all || options.codex) await installCodexHooks();
    if (all || options.gemini) await installGeminiHooks();
    if (all || options.opencode) await installOpenCodeHooks();
    if (all || options.cursor) await installCursorHooks();
    if (all || options.openclaw) await installOpenClawHooks();
    if (all || options.nanoclaw) await installNanoClawHooks();
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
  .option("--all", "remove every reversible hook")
  .action(async (options) => {
    const all = options.all || noHookAgentSelected(options);
    if (all || options.claude) await uninstallClaudeHooks();
    if (all || options.codex) await uninstallCodexHooks();
    if (all || options.gemini) await uninstallGeminiHooks();
    if (all || options.opencode) await uninstallOpenCodeHooks();
    if (all || options.cursor) await uninstallCursorHooks();
    if (all || options.openclaw) await uninstallOpenClawHooks();
    if (all || options.nanoclaw) await uninstallNanoClawHooks();
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

const plugins = program.command("plugins").description("Search, install, and remove OpenLeash plugins");

plugins
  .command("list")
  .description("List plugins available to this user")
  .option("--search <query>", "filter plugins by package name, developer, or description")
  .option("--json", "print raw JSON")
  .action(async (options) => {
    try {
      const config = await readConfig();
      const listings = await fetchPluginListings(config, options.search);
      if (options.json) {
        console.log(JSON.stringify(listings, null, 2));
        return;
      }
      printPluginListings(listings);
    } catch (error) {
      console.error(`OpenLeash plugins list failed: ${errorMessage(error)}`);
      process.exitCode = 1;
    }
  });

plugins
  .command("install")
  .description("Install one or more plugins by package slug or plugin id")
  .argument("<plugins...>", "plugin slugs or ids, for example token-saver sec-evaluator")
  .option("--json", "print raw JSON results")
  .action(async (pluginInputs: string[], options) => {
    await mutatePlugins("install", pluginInputs, options);
  });

plugins
  .command("uninstall")
  .alias("remove")
  .description("Uninstall one or more optional plugins by package slug or plugin id")
  .argument("<plugins...>", "plugin slugs or ids, for example token-saver sec-evaluator")
  .option("--json", "print raw JSON results")
  .action(async (pluginInputs: string[], options) => {
    await mutatePlugins("uninstall", pluginInputs, options);
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

function configuredRemoteApiUrl(config: { remoteApiUrl?: string; tenantUrl?: string; apiUrl?: string }) {
  const candidate =
    config.remoteApiUrl ??
    config.tenantUrl ??
    (config.apiUrl && !isLocalDesktopApiUrl(config.apiUrl) ? config.apiUrl : defaultCloudApiUrl);
  const apiUrl = /^https?:\/\//i.test(candidate) ? candidate : tenantToApiUrl(candidate);
  return apiUrl.replace(/\/+$/, "");
}

function isLocalDesktopApiUrl(apiUrl: string) {
  try {
    const url = new URL(apiUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname) && url.port === "9317";
  } catch {
    return false;
  }
}

function authHeaders(config: { token: string }, functionName: "tenantPluginsRead" | "adminPluginsWrite") {
  return {
    authorization: `Bearer ${config.token}`,
    ...apiVersionHeaders(functionName)
  };
}

async function fetchPluginListings(config: { token: string; remoteApiUrl?: string; tenantUrl?: string; apiUrl?: string }, search = "") {
  const baseUrl = configuredRemoteApiUrl(config);
  const url = new URL(`${baseUrl}/v1/plugin-marketplace`);
  if (search.trim()) url.searchParams.set("search", search.trim());
  const response = await fetch(url, { headers: authHeaders(config, "tenantPluginsRead") });
  const body = await readJsonResponse(response);
  if (!response.ok) throw new Error(apiError(body, response.statusText));
  if (body && typeof body === "object" && "listings" in body && Array.isArray(body.listings)) return body.listings as PluginListing[];
  return Array.isArray(body) ? (body as PluginListing[]) : [];
}

async function mutatePlugins(action: "install" | "uninstall", pluginInputs: string[], options: { json?: boolean }) {
  try {
    const config = await readConfig();
    const listings = await fetchPluginListings(config);
    const results = [];
    let failed = false;
    for (const input of pluginInputs) {
      try {
        const plugin = resolvePluginInput(input, listings);
        const pluginId = plugin?.id ?? input;
        const result = await mutatePlugin(config, pluginId, action);
        const label = plugin?.slug ?? plugin?.id ?? input;
        results.push({ input, plugin: label, ok: true, result });
        if (!options.json) console.log(`${label}: ${action === "install" ? "installed" : "removed"}`);
      } catch (error) {
        failed = true;
        results.push({ input, ok: false, error: errorMessage(error) });
        if (!options.json) console.error(`${input}: ${errorMessage(error)}`);
      }
    }
    if (options.json) console.log(JSON.stringify(results, null, 2));
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`OpenLeash plugins ${action} failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

async function mutatePlugin(
  config: { token: string; remoteApiUrl?: string; tenantUrl?: string; apiUrl?: string },
  pluginId: string,
  action: "install" | "uninstall"
) {
  const baseUrl = configuredRemoteApiUrl(config);
  const response = await fetch(`${baseUrl}/v1/plugins/${encodeURIComponent(pluginId)}/${action}`, {
    method: "POST",
    headers: authHeaders(config, "adminPluginsWrite")
  });
  const body = await readJsonResponse(response);
  if (!response.ok) throw new Error(apiError(body, response.statusText));
  return body;
}

function resolvePluginInput(input: string, listings: PluginListing[]) {
  const normalized = input.trim().toLowerCase();
  const matches = listings.filter((plugin) => {
    return (
      plugin.id.toLowerCase() === normalized ||
      plugin.slug?.toLowerCase() === normalized ||
      plugin.name?.toLowerCase() === normalized
    );
  });
  if (matches.length > 1) {
    throw new Error(`ambiguous plugin "${input}"; use one of ${matches.map((plugin) => plugin.slug ?? plugin.id).join(", ")}`);
  }
  return matches[0];
}

function printPluginListings(listings: PluginListing[]) {
  if (!listings.length) {
    console.log("No plugins found.");
    return;
  }
  console.table(
    listings.map((plugin) => ({
      package: plugin.slug ?? plugin.id,
      by: plugin.developerName ?? "",
      rating: plugin.rating ? plugin.rating.toFixed(1) : "",
      installs: typeof plugin.installCount === "number" ? plugin.installCount : "",
      downloads: typeof plugin.downloadCount === "number" ? plugin.downloadCount : "",
      weekly: typeof plugin.weeklyDownloadCount === "number" ? plugin.weeklyDownloadCount : "",
      trend: typeof plugin.trendPercent === "number" ? `${plugin.trendPercent >= 0 ? "+" : ""}${plugin.trendPercent}%` : "",
      status: plugin.mandatory ? "mandatory" : plugin.installed ? "installed" : plugin.installable === false ? "blocked" : "available"
    }))
  );
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function apiError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  if (typeof body === "string" && body.trim()) return body.trim();
  return fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

function tenantToApiUrl(tenant: string) {
  if (/^https?:\/\//i.test(tenant)) return tenant.replace(/\/+$/, "");
  return `https://${tenant.replace(/\/+$/, "")}`;
}

function noHookAgentSelected(options: Record<string, unknown>) {
  return !(
    options.claude ||
    options.codex ||
    options.gemini ||
    options.opencode ||
    options.cursor ||
    options.openclaw ||
    options.nanoclaw
  );
}
