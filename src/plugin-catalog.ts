export type BundledPluginManifest = {
  id: string;
  slug?: string;
  name: string;
  description: string;
  repositoryUrl?: string;
  version: string;
  publisher: string;
  runtime: "openleash-core" | "node" | "container";
  execution?: {
    type: "container";
    placement: "edge" | "server" | "either";
    protocol: "openleash-container-plugin.v1";
    image: string;
    digest?: string;
    healthPath?: string;
    transformPath?: string;
    toolExecutePath?: string;
    edgePort?: number;
    timeoutMs?: number;
    failureMode?: "open" | "closed";
    isolation?: "shared-trusted" | "tenant-dedicated" | "customer-hosted";
    resources?: { memoryMb?: number; cpuShares?: number };
    storage?: { persistent: boolean; volumeName?: string };
  };
  entrypoint: string;
  events: string[];
  permissions: string[];
  effects: string[];
  ordering?: { priority?: number; before?: string[]; after?: string[] };
  configSchema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
  tags?: string[];
};

export type PluginSettingState = {
  enabled: boolean;
  config: Record<string, unknown>;
  profiles?: Array<{
    id: string;
    name: string;
    agentKinds: string[];
    agentIds?: string[];
    enabled?: boolean;
    config: Record<string, unknown>;
    priority?: number;
  }>;
  inheritedProfiles?: PluginSettingState["profiles"];
  effectiveProfileIds?: string[];
  runtimeAvailable?: boolean;
  runtimeError?: string;
  orderingPriority?: number | null;
  installedVersion?: string;
  availableVersion?: string;
  updateAvailable?: boolean;
  updatePolicy?: "manual" | "patch" | "minor" | "locked";
  updatedAt?: string;
};

export type PluginCatalogItem = BundledPluginManifest & {
  settings: PluginSettingState;
  organizationPolicy?: {
    mandatory?: boolean;
    defaultEnabled?: boolean;
    userInstallAllowed?: boolean;
    configLocked?: boolean;
  };
};

export const bundledFirstPartyPlugins: BundledPluginManifest[] = [
  {
    id: "openleash.prompt-compression",
    slug: "token-saver",
    name: "token-saver",
    description: "Trim noisy context before every model call.",
    repositoryUrl: "https://github.com/open-leash/plugin-token-saver",
    version: "1.1.3",
    publisher: "openleash",
    runtime: "container",
    execution: {
      type: "container",
      placement: "either",
      protocol: "openleash-container-plugin.v1",
      image: "ghcr.io/open-leash/plugin-token-saver:1.1.3",
      digest: "sha256:a4b393aaea6867516c800e0c8381e03a451750a497d76870725dc8d3eaf1ffd3",
      healthPath: "/healthz",
      transformPath: "/v1/transform",
      toolExecutePath: "/v1/tools/execute",
      edgePort: 9331,
      timeoutMs: 30000,
      failureMode: "open",
      isolation: "shared-trusted",
      resources: { memoryMb: 1024, cpuShares: 1024 },
      storage: { persistent: true, volumeName: "openleash-token-saver-data" }
    },
    entrypoint: "container",
    events: ["provider.request.beforeSend", "plugin.tool.execute", "prompt.beforeSubmit"],
    permissions: ["event:read", "prompt:read", "prompt:write", "provider-request:read", "provider-request:write", "local-model:run", "storage:read", "storage:write", "audit:write", "log:write", "usage:write", "island:publish"],
    effects: ["transform", "observe"],
    ordering: { priority: 100, before: ["openleash.dlp"] },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        level: { enum: ["light", "standard", "maximum"] },
        conciseResponse: { type: "boolean" },
        model: { type: "string" },
        minimumChars: { type: "number", minimum: 256 },
        protectRecent: { type: "number", minimum: 0 },
        ccrEnabled: { type: "boolean" },
        ccrTtlSeconds: { type: "number", minimum: 60 }
      }
    },
    defaultConfig: { enabled: false, level: "standard", conciseResponse: false, minimumChars: 1200, protectRecent: 2, ccrEnabled: false, ccrTtlSeconds: 3600 },
    tags: ["tokens", "cost", "prompt"]
  },
  {
    id: "openleash.skill-scanner",
    slug: "skill-scanner",
    name: "skill-scanner",
    description: "Catch suspicious instructions before they spread.",
    repositoryUrl: "https://github.com/open-leash/plugin-skill-scanner",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/skill-scanner",
    events: ["openleash.startup", "agent.detected", "skill.detected", "skill.changed"],
    permissions: ["event:read", "filesystem:read", "decision:write", "model:invoke", "audit:write", "notification:send"],
    effects: ["observe", "ask", "inventory"],
    ordering: { priority: 150 },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        suspiciousRiskThreshold: { type: "number" }
      }
    },
    defaultConfig: { enabled: true, suspiciousRiskThreshold: 50 },
    tags: ["skills", "security", "inventory"]
  },
  {
    id: "openleash.dlp",
    slug: "data-leakage-prevention",
    name: "data-leakage-prevention",
    description: "Mask secrets before agents send them.",
    repositoryUrl: "https://github.com/open-leash/plugin-data-leakage-prevention",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/dlp",
    events: ["prompt.beforeSubmit"],
    permissions: ["event:read", "prompt:read", "prompt:write", "decision:write", "model:invoke", "audit:write"],
    effects: ["transform", "deny", "observe"],
    ordering: { priority: 200, after: ["openleash.prompt-compression"] },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        action: { enum: ["mask", "block"] },
        categories: {
          type: "array",
          items: { enum: ["pii", "phi", "tokens", "keys", "credentials"] }
        },
        model: { type: "string" }
      }
    },
    defaultConfig: { enabled: false, action: "mask", categories: ["pii", "phi", "tokens", "keys", "credentials"] },
    tags: ["security", "privacy", "prompt"]
  },
  {
    id: "openleash.sensitive-access",
    slug: "sensitive-access",
    name: "sensitive-access",
    description: "Catch agents reading secrets, printing env vars, or touching credential files.",
    repositoryUrl: "https://github.com/open-leash/plugin-sensitive-access",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/sensitive-access",
    events: ["prompt.beforeSubmit", "agent.response", "tool.beforeUse", "tool.afterUse"],
    permissions: ["event:read", "prompt:read", "tool:read", "model:invoke", "decision:write", "audit:write", "log:write", "signal:write"],
    effects: ["observe", "ask", "deny"],
    ordering: { priority: 180, before: ["openleash.dlp", "openleash.blast-radius", "openleash.rules-enforcer"] },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        secretFileAction: { enum: ["ask", "block"] },
        envDumpAction: { enum: ["ask", "block"] },
        exfiltrationAction: { enum: ["ask", "block"] }
      }
    },
    defaultConfig: { enabled: true, secretFileAction: "ask", envDumpAction: "block", exfiltrationAction: "block" },
    tags: ["security", "secrets", "credentials", "privacy"]
  },
  {
    id: "openleash.blast-radius",
    slug: "blast-radius",
    name: "blast-radius",
    description: "Block destructive tool use before agents damage files, databases, or infrastructure.",
    repositoryUrl: "https://github.com/open-leash/plugin-blast-radius",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/blast-radius",
    events: ["tool.beforeUse"],
    permissions: ["event:read", "tool:read", "decision:write", "audit:write", "log:write", "signal:write", "island:publish"],
    effects: ["observe", "ask", "deny"],
    ordering: { priority: 220, before: ["openleash.rules-enforcer", "openleash.mcp-scanner"] },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        destructiveAction: { enum: ["ask", "block"] },
        databaseMutationAction: { enum: ["ask", "block"] },
        broadFilesystemAction: { enum: ["ask", "block"] }
      }
    },
    defaultConfig: { enabled: true, destructiveAction: "block", databaseMutationAction: "ask", broadFilesystemAction: "block" },
    tags: ["security", "destructive", "database", "tools"]
  },
  {
    id: "openleash.rules-enforcer",
    slug: "rules-enforcer",
    name: "rules-enforcer",
    description: "Watch agent conversations and pause when configured rules are violated.",
    repositoryUrl: "https://github.com/open-leash/plugin-rules-enforcer",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/rules-enforcer",
    events: ["prompt.beforeSubmit", "agent.response", "tool.beforeUse", "tool.afterUse"],
    permissions: ["event:read", "prompt:read", "tool:read", "decision:write", "model:invoke", "audit:write", "notification:send"],
    effects: ["observe", "ask", "deny"],
    ordering: { priority: 300, after: ["openleash.dlp"] },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        rules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              action: { type: "string", enum: ["ask", "block"] }
            }
          }
        }
      }
    },
    defaultConfig: { enabled: true, rules: [] },
    tags: ["security", "rules", "policy", "approval"]
  },
  {
    id: "openleash.mcp-scanner",
    slug: "mcp-scanner",
    name: "mcp-scanner",
    description: "See every MCP server, tool, and call.",
    repositoryUrl: "https://github.com/open-leash/plugin-mcp-scanner",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/mcp-scanner",
    events: ["tool.beforeUse", "tool.afterUse"],
    permissions: ["event:read", "tool:read", "audit:write"],
    effects: ["observe", "inventory"],
    ordering: { priority: 400, after: ["openleash.rules-enforcer"] },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        redactSecrets: { type: "boolean" }
      }
    },
    defaultConfig: { enabled: true, redactSecrets: true },
    tags: ["security", "mcp", "inventory", "audit"]
  }
];

export function bundledPluginCatalog(): PluginCatalogItem[] {
  return bundledFirstPartyPlugins.map((plugin) => ({
    ...plugin,
    settings: {
      enabled: false,
      config: plugin.defaultConfig ?? {},
      orderingPriority: plugin.ordering?.priority ?? null
    }
  }));
}
