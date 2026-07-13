import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOCAL_PROXY_URL = "http://127.0.0.1:9320";
function agentProxyUrl(kind: string, openAi = false) {
  return `${LOCAL_PROXY_URL}/agent/${kind}${openAi ? "/v1" : ""}`;
}
const CONTAINER_NAME = "openleash-local-proxy";
const IMAGE =
  process.env.OPENLEASH_LOCAL_PROXY_IMAGE ||
  "ghcr.io/open-leash/local-proxy:latest";

export type ProxyAgentKind = "claude-code" | "codex" | "nanoclaw" | "opencode";
export const PROXY_AGENT_SUPPORT = {
  "claude-code": {
    mode: "automatic",
    surfaces: ["Claude CLI", "Claude Code VS Code"],
  },
  codex: { mode: "automatic", surfaces: ["Codex CLI", "Codex VS Code"] },
  nanoclaw: { mode: "automatic", surfaces: ["NanoClaw"] },
  opencode: {
    mode: "automatic",
    surfaces: ["OpenCode CLI", "OpenCode desktop"],
  },
  cursor: {
    mode: "manual",
    surfaces: ["Cursor editor", "Cursor CLI"],
    instructions: `Set the OpenAI override URL to ${LOCAL_PROXY_URL}/v1 and Anthropic base URL to ${LOCAL_PROXY_URL} in Cursor Settings > Models.`,
  },
  cline: {
    mode: "manual",
    surfaces: ["Cline VS Code"],
    instructions: `Choose OpenAI Compatible in Cline provider settings and set Base URL to ${LOCAL_PROXY_URL}/v1.`,
  },
  "github-copilot": {
    mode: "hooks",
    surfaces: ["Copilot CLI", "Copilot VS Code"],
    instructions:
      "Copilot remains protected by OpenLeash hooks. BYOK proxy routing requires a launch environment and is not persisted by Copilot.",
  },
  openclaw: {
    mode: "hooks",
    surfaces: ["OpenClaw"],
    instructions:
      "OpenClaw remains protected by its OpenLeash hook pack; gateway proxying requires an OpenClaw runtime plugin.",
  },
} as const;
export type LocalProxyStatus = {
  dockerAvailable: boolean;
  containerInstalled: boolean;
  running: boolean;
  healthy: boolean;
  url: string;
  image: string;
  configuredAgents: ProxyAgentKind[];
  error?: string;
};

export async function localProxyStatus(): Promise<LocalProxyStatus> {
  const dockerAvailable = commandOk([
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  if (!dockerAvailable)
    return baseStatus({ dockerAvailable, error: "Docker is not available." });
  const inspect = docker([
    "inspect",
    "-f",
    "{{.State.Running}}",
    CONTAINER_NAME,
  ]);
  const containerInstalled = inspect.status === 0;
  const running = containerInstalled && inspect.stdout.trim() === "true";
  let healthy = false;
  if (running) {
    try {
      healthy = (
        await fetch(`${LOCAL_PROXY_URL}/healthz`, {
          signal: AbortSignal.timeout(1500),
        })
      ).ok;
    } catch {
      /* status remains unhealthy */
    }
  }
  return baseStatus({ dockerAvailable, containerInstalled, running, healthy });
}

export async function installLocalProxy(options: {
  clientApiUrl: string;
  token: string;
  agents?: string[];
  corporateProxy?: string;
}) {
  if (!commandOk(["version", "--format", "{{.Server.Version}}"]))
    throw new Error("Docker Desktop or Docker Engine must be running.");
  if (!options.token.trim())
    throw new Error(
      "OpenLeash backend token is required before installing the proxy.",
    );
  docker(["rm", "-f", CONTAINER_NAME]);
  const args = [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "--restart",
    "unless-stopped",
    // Docker Desktop defines this host automatically. Docker Engine on Linux
    // does not, so declare the portable host-gateway mapping explicitly.
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    "127.0.0.1:9320:9320",
    "-e",
    "OPENLEASH_PROXY_LISTEN=0.0.0.0:9320",
    "-e",
    `OPENLEASH_CLIENT_API=${dockerReachableApiUrl(options.clientApiUrl)}`,
    "-e",
    `OPENLEASH_TOKEN=${options.token}`,
    "-e",
    "OPENLEASH_ANTHROPIC_UPSTREAM=https://api.anthropic.com",
    "-e",
    "OPENLEASH_OPENAI_UPSTREAM=https://api.openai.com",
  ];
  if (options.corporateProxy?.trim())
    args.push(
      "-e",
      `OPENLEASH_CORPORATE_PROXY=${options.corporateProxy.trim()}`,
    );
  args.push(IMAGE);
  const result = docker(args);
  if (result.status !== 0)
    throw new Error(
      result.stderr.trim() || "Could not start the OpenLeash proxy container.",
    );
  for (const agent of options.agents ?? []) configureAgentProxy(agent, true);
  return waitForHealthyProxy();
}

export async function uninstallLocalProxy() {
  for (const agent of ["claude-code", "codex", "nanoclaw", "opencode"] as const)
    configureAgentProxy(agent, false);
  docker(["rm", "-f", CONTAINER_NAME]);
  return localProxyStatus();
}

export function configureAgentProxy(kind: string, enabled: boolean) {
  if (kind === "claude-code") return configureClaude(enabled);
  if (kind === "codex") return configureCodex(enabled);
  if (kind === "nanoclaw")
    return configureClaudeCompatible(
      path.join(os.homedir(), ".nanoclaw", "settings.json"),
      enabled,
    );
  if (kind === "opencode") return configureOpenCode(enabled);
  const support = PROXY_AGENT_SUPPORT[kind as keyof typeof PROXY_AGENT_SUPPORT];
  if (support && "instructions" in support)
    throw new Error(support.instructions);
  throw new Error(
    `${kind} does not expose a stable supported model API base URL configuration.`,
  );
}

function configureClaude(enabled: boolean) {
  return configureClaudeCompatible(
    path.join(os.homedir(), ".claude", "settings.json"),
    enabled,
  );
}

function configureClaudeCompatible(file: string, enabled: boolean) {
  const backup = `${file}.openleash-proxy-backup`;
  if (!enabled) return restoreBackup(file, backup);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(backup))
    fs.writeFileSync(
      backup,
      fs.existsSync(file) ? fs.readFileSync(file) : "{}\n",
    );
  const settings = readJson(file);
  const env =
    settings.env && typeof settings.env === "object"
      ? (settings.env as Record<string, unknown>)
      : {};
  const kind = file.includes(`${path.sep}.nanoclaw${path.sep}`)
    ? "nanoclaw"
    : "claude-code";
  settings.env = { ...env, ANTHROPIC_BASE_URL: agentProxyUrl(kind) };
  writeJson(file, settings);
}

function configureOpenCode(enabled: boolean) {
  const file = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  const backup = `${file}.openleash-proxy-backup`;
  if (!enabled) return restoreBackup(file, backup);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(backup)) {
    const original = fs.existsSync(file)
      ? fs.readFileSync(file)
      : Buffer.from("{}\n");
    // Never replace an existing JSON/JSONC-looking configuration with an empty
    // object. OpenCode supports JSONC, but safely editing comments requires a
    // syntax-aware editor; those users receive an actionable manual path.
    if (fs.existsSync(file)) parseJsonOrThrow(file, original.toString("utf8"));
    fs.writeFileSync(backup, original);
  }
  const config = parseJsonOrThrow(backup, fs.readFileSync(backup, "utf8"));
  const providers =
    config.provider && typeof config.provider === "object"
      ? (config.provider as Record<string, unknown>)
      : {};
  config.provider = {
    ...providers,
    anthropic: mergeProviderBaseUrl(
      providers.anthropic,
      agentProxyUrl("opencode"),
    ),
    openai: mergeProviderBaseUrl(
      providers.openai,
      agentProxyUrl("opencode", true),
    ),
  };
  writeJson(file, config);
}

function mergeProviderBaseUrl(value: unknown, baseURL: string) {
  const provider =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const options =
    provider.options && typeof provider.options === "object"
      ? (provider.options as Record<string, unknown>)
      : {};
  return { ...provider, options: { ...options, baseURL } };
}

function configureCodex(enabled: boolean) {
  const file = path.join(os.homedir(), ".codex", "config.toml");
  const backup = `${file}.openleash-proxy-backup`;
  if (!enabled) return restoreBackup(file, backup);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(backup))
    fs.writeFileSync(backup, fs.existsSync(file) ? fs.readFileSync(file) : "");
  let source = fs.readFileSync(backup, "utf8");
  source = source
    .replace(/^model_provider\s*=.*$/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const block = `# Managed by OpenLeash local proxy\nmodel_provider = "openleash"\n\n${source}\n\n[model_providers.openleash]\nname = "OpenLeash local proxy"\nbase_url = "${agentProxyUrl("codex", true)}"\nwire_api = "responses"\nrequires_openai_auth = true\n`;
  fs.writeFileSync(
    file,
    block.replace(`\n\n${source}\n\n`, source ? `\n\n${source}\n\n` : "\n\n"),
  );
}

function configuredAgents(): ProxyAgentKind[] {
  const result: ProxyAgentKind[] = [];
  const claude = readJson(path.join(os.homedir(), ".claude", "settings.json"));
  if (
    (claude.env as Record<string, unknown> | undefined)?.ANTHROPIC_BASE_URL ===
    agentProxyUrl("claude-code")
  )
    result.push("claude-code");
  try {
    if (
      fs
        .readFileSync(path.join(os.homedir(), ".codex", "config.toml"), "utf8")
        .includes("# Managed by OpenLeash local proxy")
    )
      result.push("codex");
  } catch {
    /* absent */
  }
  const nanoclaw = readJson(
    path.join(os.homedir(), ".nanoclaw", "settings.json"),
  );
  if (
    (nanoclaw.env as Record<string, unknown> | undefined)
      ?.ANTHROPIC_BASE_URL === agentProxyUrl("nanoclaw")
  )
    result.push("nanoclaw");
  const opencode = readJson(
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
  );
  const providers = opencode.provider as
    Record<string, { options?: { baseURL?: string } }> | undefined;
  if (
    providers?.anthropic?.options?.baseURL === agentProxyUrl("opencode") &&
    providers?.openai?.options?.baseURL === agentProxyUrl("opencode", true)
  )
    result.push("opencode");
  return result;
}

async function waitForHealthyProxy() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await localProxyStatus();
    if (status.healthy) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const logs = docker(["logs", "--tail", "30", CONTAINER_NAME]);
  throw new Error(
    `Proxy container did not become healthy. ${logs.stderr || logs.stdout}`.trim(),
  );
}

function dockerReachableApiUrl(value: string) {
  const url = new URL(value);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname))
    url.hostname = "host.docker.internal";
  return url.toString().replace(/\/$/, "");
}
function baseStatus(overrides: Partial<LocalProxyStatus>): LocalProxyStatus {
  return {
    dockerAvailable: false,
    containerInstalled: false,
    running: false,
    healthy: false,
    url: LOCAL_PROXY_URL,
    image: IMAGE,
    configuredAgents: configuredAgents(),
    ...overrides,
  };
}
function docker(args: string[]) {
  return spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });
}
function commandOk(args: string[]) {
  return docker(args).status === 0;
}
function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
function parseJsonOrThrow(
  file: string,
  source: string,
): Record<string, unknown> {
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch {
    throw new Error(
      `OpenLeash did not modify ${file} because it is not strict JSON. Set provider.anthropic.options.baseURL to ${agentProxyUrl("opencode")} and provider.openai.options.baseURL to ${agentProxyUrl("opencode", true)} manually.`,
    );
  }
}
function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function restoreBackup(file: string, backup: string) {
  if (!fs.existsSync(backup)) return;
  fs.copyFileSync(backup, file);
  fs.rmSync(backup, { force: true });
}
