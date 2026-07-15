import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import type { PluginCatalogItem } from "./plugin-catalog";

const PROTOCOL = "openleash-container-plugin.v1";
const MANAGED_LABEL = "com.openleash.plugin-managed=true";
const ALLOWED_ROOTS = new Set(["messages", "input", "system", "tools", "prompt_cache_key"]);

export const pluginRuntimeSecret = crypto.randomBytes(32).toString("hex");
const pluginRuntimeSecretHash = crypto.createHash("sha256").update(pluginRuntimeSecret).digest("hex");

export type PluginContainerStatus = {
  pluginId: string;
  containerName: string;
  image: string;
  running: boolean;
  healthy: boolean;
  endpoint: string;
  error?: string;
};

export async function reconcilePluginContainers(
  plugins: PluginCatalogItem[],
): Promise<PluginContainerStatus[]> {
  const desired = plugins.filter(isDesiredEdgeContainer);
  if (!dockerOk(["version", "--format", "{{.Server.Version}}"])) {
    return desired.map((plugin) => ({
      pluginId: plugin.id,
      containerName: containerName(plugin.id),
      image: plugin.execution!.image,
      running: false,
      healthy: false,
      endpoint: statusEndpoint(plugin),
      error: "Docker is unavailable; install or start Docker to run this plugin",
    }));
  }
  const desiredNames = new Set(desired.map((plugin) => containerName(plugin.id)));
  for (const name of managedContainerNames()) {
    if (!desiredNames.has(name)) docker(["rm", "-f", name]);
  }
  const statuses: PluginContainerStatus[] = [];
  for (const plugin of desired) statuses.push(await reconcileOne(plugin));
  return statuses;
}

export async function transformViaLocalPluginContainers(input: {
  plugins: PluginCatalogItem[];
  provider: string;
  agentKind: string;
  agentId?: string;
  sessionId: string;
  organizationId: string;
  userId: string;
  requestBody: Record<string, unknown>;
}) {
  let payload: unknown = structuredClone(input.requestBody);
  const appliedPluginIds: string[] = [];
  const runs: Array<Record<string, unknown>> = [];
  const scopedPlugins = input.plugins
    .map((plugin) => pluginForAgent(plugin, input.agentKind, input.agentId))
    .filter((plugin) => plugin.settings.enabled && isDesiredEdgeContainer(plugin));
  for (const plugin of scopedPlugins) {
    const requestId = crypto.randomUUID();
    const envelope = {
      protocol: PROTOCOL,
      requestId,
      plugin: { id: plugin.id, version: plugin.settings.installedVersion ?? plugin.version },
      tenant: { organizationId: input.organizationId, userId: input.userId },
      event: "provider.request.beforeSend",
      context: {
        provider: input.provider,
        agentKind: input.agentKind,
        agentId: input.agentId,
        sessionId: input.sessionId,
      },
      settings: settingsContext(plugin.settings),
      config: plugin.settings.config,
      payload,
    };
    const body = JSON.stringify(envelope);
    const timestamp = String(Date.now());
    const signature = crypto
      .createHmac("sha256", pluginRuntimeSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    try {
      const result = await invokePluginHttp(plugin, plugin.execution!.transformPath ?? "/v1/transform", body, {
          "content-type": "application/json",
          "x-openleash-plugin-protocol": PROTOCOL,
          "x-openleash-plugin-id": plugin.id,
          "x-openleash-plugin-version": envelope.plugin.version,
          "x-openleash-timestamp": timestamp,
          "x-openleash-signature": `sha256=${signature}`,
        }) as {
        protocol?: string;
        requestId?: string;
        status?: string;
        patches?: Array<{ op: "add" | "replace" | "remove"; path: string; value?: unknown }>;
        summary?: string;
        metrics?: Record<string, unknown>;
        ccrHashes?: string[];
        emissions?: {
          logs?: Array<Record<string, unknown>>;
          signals?: Array<Record<string, unknown>>;
          usage?: Array<Record<string, unknown>>;
        };
      };
      if (result.protocol !== PROTOCOL || result.requestId !== requestId)
        throw new Error("incompatible or uncorrelated plugin response");
      if (result.status === "modified") {
        payload = applyProviderPatches(payload, result.patches ?? []);
        appliedPluginIds.push(plugin.id);
      }
      runs.push({ pluginId: plugin.id, status: result.status, summary: result.summary, metrics: result.metrics, ccrHashes: result.ccrHashes, emissions: result.emissions });
    } catch (error) {
      runs.push({ pluginId: plugin.id, status: "failed", summary: error instanceof Error ? error.message : String(error) });
      if ((plugin.execution?.failureMode ?? "open") === "closed") throw error;
    }
  }
  return { protocol: PROTOCOL, requestBody: payload, appliedPluginIds, runs };
}

export async function executeViaLocalPluginContainer(input: {
  plugin: PluginCatalogItem;
  sessionId: string;
  organizationId: string;
  userId: string;
  tool: string;
  arguments: Record<string, unknown>;
}) {
  const execution = input.plugin.execution;
  if (!input.plugin.settings.enabled || execution?.type !== "container" || !execution.toolExecutePath) {
    throw new Error(`plugin ${input.plugin.id} does not expose tool execution`);
  }
  const requestId = crypto.randomUUID();
  const envelope = {
    protocol: PROTOCOL,
    requestId,
    plugin: { id: input.plugin.id, version: input.plugin.settings.installedVersion ?? input.plugin.version },
    tenant: { organizationId: input.organizationId, userId: input.userId },
    event: "plugin.tool.execute",
    context: { sessionId: input.sessionId },
    settings: settingsContext(input.plugin.settings),
    config: input.plugin.settings.config,
    tool: input.tool,
    arguments: input.arguments,
  };
  const body = JSON.stringify(envelope);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", pluginRuntimeSecret).update(`${timestamp}.${body}`).digest("hex");
  const result = await invokePluginHttp(input.plugin, execution.toolExecutePath, body, {
      "content-type": "application/json",
      "x-openleash-plugin-protocol": PROTOCOL,
      "x-openleash-plugin-id": input.plugin.id,
      "x-openleash-plugin-version": envelope.plugin.version,
      "x-openleash-timestamp": timestamp,
      "x-openleash-signature": `sha256=${signature}`,
    }) as Record<string, unknown>;
  if (result.protocol !== PROTOCOL || result.requestId !== requestId) throw new Error("incompatible or uncorrelated plugin tool response");
  return result;
}

export function containerRunArgs(
  plugin: PluginCatalogItem,
  options: { name?: string; randomPort?: boolean; ephemeral?: boolean } = {},
) {
  const execution = plugin.execution!;
  const name = options.name ?? containerName(plugin.id);
  const image = execution.digest
    ? `${execution.image.split("@")[0]}@${execution.digest}`
    : execution.image;
  const args = [
    "run", "-d", "--name", name,
    "--label", MANAGED_LABEL,
    "--label", `com.openleash.plugin-id=${plugin.id}`,
    "--label", `com.openleash.plugin-version=${plugin.settings.installedVersion ?? plugin.version}`,
    "--label", `com.openleash.runtime-secret-hash=${pluginRuntimeSecretHash}`,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", "256", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m,mode=1777",
    "--memory", `${execution.resources?.memoryMb ?? 512}m`,
    "--cpu-shares", String(execution.resources?.cpuShares ?? 512),
    "-e", `OPENLEASH_PLUGIN_RUNTIME_SECRET=${pluginRuntimeSecret}`,
    "-e", "HF_HOME=/data/huggingface",
    "-e", "XDG_CACHE_HOME=/data/cache",
    "-e", "HEADROOM_HOME=/data/headroom",
  ];
  if (!plugin.permissions.includes("network:access")) args.push("--network", "none");
  if (!options.ephemeral) args.splice(4, 0, "--restart", "unless-stopped");
  if (execution.storage?.persistent && !options.ephemeral) {
    args.push("-v", `${execution.storage.volumeName ?? `${name}-data`}:/data`);
  } else if (options.ephemeral) {
    args.push("--tmpfs", "/data:rw,noexec,nosuid,size=512m,mode=1777");
  }
  if (execution.edgePort && plugin.permissions.includes("network:access")) {
    args.push("-p", options.randomPort ? "127.0.0.1::8080" : `127.0.0.1:${execution.edgePort}:8080`);
  }
  args.push(image);
  return args;
}

function isDesiredEdgeContainer(plugin: PluginCatalogItem) {
  return Boolean(
    plugin.settings?.runtimeAvailable !== false &&
      (plugin.settings?.enabled || plugin.settings?.profiles?.some((profile) => profile.enabled === true)) &&
      plugin.runtime === "container" &&
      plugin.execution?.type === "container" &&
      ["edge", "either"].includes(plugin.execution.placement),
  );
}

function pluginForAgent(plugin: PluginCatalogItem, agentKind: string, agentId?: string): PluginCatalogItem {
  let enabled = plugin.settings.enabled;
  let config = { ...plugin.settings.config };
  const effectiveProfileIds: string[] = [];
  const apply = (scope: "organization" | "user", profiles = plugin.settings.profiles ?? []) => {
    for (const profile of [...profiles].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id))) {
      if (profile.agentKinds.length > 0 && !profile.agentKinds.includes(agentKind)) continue;
      if ((profile.agentIds?.length ?? 0) > 0 && (!agentId || !profile.agentIds!.includes(agentId))) continue;
      if (typeof profile.enabled === "boolean") enabled = profile.enabled;
      config = { ...config, ...profile.config };
      effectiveProfileIds.push(`${scope}:${profile.id}`);
    }
  };
  apply("organization", plugin.settings.inheritedProfiles ?? []);
  apply("user", plugin.settings.profiles ?? []);
  return {
    ...plugin,
    settings: { ...plugin.settings, enabled, config, effectiveProfileIds },
  };
}

function settingsContext(settings: PluginCatalogItem["settings"]) {
  return {
    profileIds: settings.effectiveProfileIds ?? [],
    configHash: crypto.createHash("sha256").update(JSON.stringify(settings.config)).digest("hex"),
  };
}

async function reconcileOne(plugin: PluginCatalogItem): Promise<PluginContainerStatus> {
  const name = containerName(plugin.id);
  const endpoint = statusEndpoint(plugin);
  const image = plugin.execution!.image;
  const expectedVersion = plugin.settings.installedVersion ?? plugin.version;
  const inspect = docker(["inspect", "-f", "{{.State.Running}} {{index .Config.Labels \"com.openleash.plugin-version\"}} {{index .Config.Labels \"com.openleash.runtime-secret-hash\"}}", name]);
  const reusable = inspect.status === 0 && inspect.stdout.trim() === `true ${expectedVersion} ${pluginRuntimeSecretHash}`;
  if (!reusable) {
    const imageRef = plugin.execution!.digest
      ? `${image.split("@")[0]}@${plugin.execution!.digest}`
      : image;
    if (!dockerOk(["image", "inspect", imageRef])) {
      const pull = docker(["pull", imageRef], 300_000);
      if (pull.status !== 0) {
        return { pluginId: plugin.id, containerName: name, image, running: false, healthy: false, endpoint, error: pull.stderr.trim() || "image pull failed" };
      }
    }
    const preflight = await preflightContainer(plugin);
    if (!preflight.ok) {
      return { pluginId: plugin.id, containerName: name, image, running: inspect.status === 0, healthy: false, endpoint, error: preflight.error };
    }
    const backupName = `${name}-rollback`;
    const hadPrevious = inspect.status === 0;
    docker(["rm", "-f", backupName]);
    if (hadPrevious) {
      docker(["stop", "--time", "10", name]);
      const renamed = docker(["rename", name, backupName]);
      if (renamed.status !== 0) {
        docker(["start", name]);
        return { pluginId: plugin.id, containerName: name, image, running: true, healthy: false, endpoint, error: renamed.stderr.trim() || "could not stage plugin rollback" };
      }
    }
    const started = docker(containerRunArgs(plugin), 180_000);
    if (started.status !== 0) {
      restoreRollback(name, backupName, hadPrevious);
      return { pluginId: plugin.id, containerName: name, image, running: hadPrevious, healthy: hadPrevious, endpoint, error: started.stderr.trim() || "container start failed; previous version restored" };
    }
    const healthy = await managedContainerHealth(plugin, name, endpoint);
    if (!healthy) {
      restoreRollback(name, backupName, hadPrevious);
      return { pluginId: plugin.id, containerName: name, image, running: hadPrevious, healthy: hadPrevious, endpoint, error: "plugin update failed health check; previous version restored" };
    }
    if (hadPrevious) docker(["rm", "-f", backupName]);
    return { pluginId: plugin.id, containerName: name, image, running: true, healthy: true, endpoint };
  }
  const healthy = await managedContainerHealth(plugin, name, endpoint);
  return { pluginId: plugin.id, containerName: name, image, running: true, healthy, endpoint, ...(healthy ? {} : { error: "plugin did not become healthy" }) };
}

function managedContainerHealth(plugin: PluginCatalogItem, name: string, endpoint: string) {
  return plugin.permissions.includes("network:access")
    ? waitForHealth(endpoint, plugin.id)
    : waitForContainerHealth(name, plugin.execution?.healthPath ?? "/healthz", plugin.id);
}

async function preflightContainer(plugin: PluginCatalogItem): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = `${containerName(plugin.id)}-candidate-${crypto.randomBytes(4).toString("hex")}`;
  const started = docker(containerRunArgs(plugin, { name, randomPort: true, ephemeral: true }), 180_000);
  if (started.status !== 0) return { ok: false, error: started.stderr.trim() || "candidate container did not start" };
  try {
    const path = plugin.execution?.healthPath ?? "/healthz";
    const healthy = plugin.permissions.includes("network:access")
      ? await (async () => {
          const portResult = docker(["port", name, "8080/tcp"]);
          const match = portResult.stdout.match(/127\.0\.0\.1:(\d+)/);
          return Boolean(match) && waitForHealth(`http://127.0.0.1:${match![1]}/${path.replace(/^\/+/, "")}`, plugin.id);
        })()
      : await waitForContainerHealth(name, path, plugin.id);
    return healthy ? { ok: true } : { ok: false, error: "candidate plugin image failed its health check; current version was kept" };
  } finally {
    docker(["rm", "-f", name]);
  }
}

function restoreRollback(name: string, backupName: string, hadPrevious: boolean) {
  docker(["rm", "-f", name]);
  if (hadPrevious) {
    docker(["rename", backupName, name]);
    docker(["start", name]);
  }
}

function applyProviderPatches(payload: unknown, patches: Array<{ op: "add" | "replace" | "remove"; path: string; value?: unknown }>) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("provider payload is not an object");
  if (patches.length > 256) throw new Error("plugin returned too many patches");
  const output = structuredClone(payload) as Record<string, unknown>;
  for (const patch of patches) {
    const segments = patch.path.startsWith("/")
      ? patch.path.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
      : [];
    if (!segments.length || !ALLOWED_ROOTS.has(segments[0])) throw new Error(`plugin patch path is forbidden: ${patch.path}`);
    let parent: any = output;
    for (const segment of segments.slice(0, -1)) parent = Array.isArray(parent) ? parent[Number(segment)] : parent?.[segment];
    if (!parent || typeof parent !== "object") throw new Error(`plugin patch path does not exist: ${patch.path}`);
    const key = segments.at(-1)!;
    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error(`invalid array patch index: ${key}`);
      if (patch.op === "remove") parent.splice(index, 1);
      else if (patch.op === "add") parent.splice(index, 0, structuredClone(patch.value));
      else parent[index] = structuredClone(patch.value);
    } else if (patch.op === "remove") delete parent[key];
    else parent[key] = structuredClone(patch.value);
  }
  return output;
}

function pluginEndpoint(plugin: PluginCatalogItem, path: string) {
  const port = plugin.execution?.edgePort;
  if (!port) throw new Error(`plugin ${plugin.id} has no desktop edge port`);
  return `http://127.0.0.1:${port}/${path.replace(/^\/+/, "")}`;
}

function statusEndpoint(plugin: PluginCatalogItem) {
  return plugin.permissions.includes("network:access")
    ? pluginEndpoint(plugin, plugin.execution?.healthPath ?? "/healthz")
    : `docker://${containerName(plugin.id)}`;
}

function containerName(pluginId: string) {
  return `openleash-plugin-${pluginId.replace(/^openleash\./, "").replace(/[^a-z0-9_.-]+/gi, "-").toLowerCase()}`;
}

function managedContainerNames() {
  const result = docker(["ps", "-a", "--filter", `label=${MANAGED_LABEL}`, "--format", "{{.Names}}"]) ;
  return result.status === 0 ? result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) : [];
}

async function waitForHealth(endpoint: string, pluginId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
      const body = (await response.json()) as { ok?: boolean; pluginId?: string; protocol?: string };
      if (response.ok && body.ok && body.pluginId === pluginId && body.protocol === PROTOCOL) return true;
    } catch { /* retry while the model/runtime initializes */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function waitForContainerHealth(name: string, path: string, pluginId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker(["exec", name, "python", "-c", `import json,urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/${path.replace(/^\/+/, "")}',timeout=1).read().decode())`], 2_000);
    if (result.status === 0) {
      try {
        const body = JSON.parse(result.stdout.trim());
        if (body.ok && body.pluginId === pluginId && body.protocol === PROTOCOL) return true;
      } catch { /* retry */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function invokePluginHttp(plugin: PluginCatalogItem, path: string, body: string, headers: Record<string, string>) {
  if (plugin.permissions.includes("network:access")) {
    const response = await fetch(pluginEndpoint(plugin, path), { method: "POST", headers, body, signal: AbortSignal.timeout(plugin.execution?.timeoutMs ?? 30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  const script = "import json,sys,urllib.request; w=json.load(sys.stdin); r=urllib.request.Request('http://127.0.0.1:8080/'+w['path'].lstrip('/'),data=w['body'].encode(),headers=w['headers'],method='POST'); print(urllib.request.urlopen(r,timeout=w['timeout']).read().decode())";
  const payload = JSON.stringify({ path, body, headers, timeout: Math.ceil((plugin.execution?.timeoutMs ?? 30_000) / 1000) });
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", containerName(plugin.id), "python", "-c", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("plugin container call timed out")); }, plugin.execution?.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `docker exec exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("plugin returned invalid JSON")); }
    });
    child.stdin.end(payload);
  });
}

function docker(args: string[], timeout = 120_000) {
  return spawnSync("docker", args, { encoding: "utf8", timeout });
}

function dockerOk(args: string[]) {
  return docker(args).status === 0;
}
