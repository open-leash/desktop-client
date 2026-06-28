export type BundledPluginManifest = {
  id: string;
  slug?: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  runtime: "openleash-core" | "node";
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
  orderingPriority?: number | null;
  updatedAt?: string;
};

export type PluginCatalogItem = BundledPluginManifest & {
  settings: PluginSettingState;
};

export const bundledFirstPartyPlugins: BundledPluginManifest[] = [
  {
    id: "openleash.prompt-compression",
    slug: "token-saver",
    name: "token-saver",
    description: "Trim noisy context before every model call.",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/prompt-compression",
    events: ["prompt.beforeSubmit"],
    permissions: ["event:read", "prompt:read", "prompt:write", "model:invoke", "audit:write"],
    effects: ["transform", "observe"],
    ordering: { priority: 100, before: ["openleash.dlp"] },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        level: { enum: ["light", "standard", "maximum"] },
        conciseResponse: { type: "boolean" },
        model: { type: "string" }
      }
    },
    defaultConfig: { enabled: false, level: "standard", conciseResponse: false },
    tags: ["tokens", "cost", "prompt"]
  },
  {
    id: "openleash.skill-scanner",
    slug: "skill-scanner",
    name: "skill-scanner",
    description: "Catch suspicious instructions before they spread.",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/skill-scanner",
    events: ["openleash.startup", "agent.detected", "skill.changed"],
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
    id: "openleash.rules-enforcer",
    slug: "rules-enforcer",
    name: "rules-enforcer",
    description: "Watch agent conversations and pause when configured rules are violated.",
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
    tags: ["mcp", "inventory", "audit"]
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
