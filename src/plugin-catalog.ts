export type BundledPluginManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  runtime: "openleash-core" | "node";
  entrypoint: string;
  stages: string[];
  permissions: string[];
  effects: string[];
  ordering?: { priority?: number; before?: string[]; after?: string[] };
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
    name: "Prompt Compression",
    description: "Compresses user prompts before they reach the agent model to reduce token usage.",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/prompt-compression",
    stages: ["prompt.beforeSubmit"],
    permissions: ["event:read", "prompt:read", "prompt:write", "model:invoke", "audit:write"],
    effects: ["transform", "observe"],
    ordering: { priority: 100, before: ["openleash.dlp"] },
    defaultConfig: { enabled: false, level: "standard", conciseResponse: false },
    tags: ["tokens", "cost", "prompt"]
  },
  {
    id: "openleash.skill-scanner",
    name: "Skill Scanner",
    description: "Scans agent skills for suspicious instructions and records skill inventory.",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/skill-scanner",
    stages: ["openleash.startup", "agent.detected", "skill.changed"],
    permissions: ["event:read", "filesystem:read", "decision:write", "model:invoke", "audit:write", "notification:send"],
    effects: ["observe", "ask", "inventory"],
    ordering: { priority: 150 },
    defaultConfig: { enabled: true, suspiciousRiskThreshold: 50 },
    tags: ["skills", "security", "inventory"]
  },
  {
    id: "openleash.dlp",
    name: "Data Leakage Prevention",
    description: "Masks or blocks sensitive prompt data before submission.",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/dlp",
    stages: ["prompt.beforeSubmit"],
    permissions: ["event:read", "prompt:read", "prompt:write", "decision:write", "model:invoke", "audit:write"],
    effects: ["transform", "deny", "observe"],
    ordering: { priority: 200, after: ["openleash.prompt-compression"] },
    defaultConfig: { enabled: false, action: "mask", categories: ["pii", "phi", "tokens", "keys", "credentials"] },
    tags: ["security", "privacy", "prompt"]
  },
  {
    id: "openleash.security-evaluator",
    name: "Security Evaluator",
    description: "Evaluates prompts, agent responses, and tool actions against organization policy.",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/security-evaluator",
    stages: ["prompt.beforeSubmit", "agent.response", "tool.beforeUse", "tool.afterUse"],
    permissions: ["event:read", "prompt:read", "tool:read", "decision:write", "model:invoke", "audit:write", "notification:send"],
    effects: ["observe", "ask", "deny"],
    ordering: { priority: 300, after: ["openleash.dlp"] },
    defaultConfig: { enabled: true, policySet: "active" },
    tags: ["security", "policy", "approval"]
  },
  {
    id: "openleash.mcp-scanner",
    name: "MCP Scanner",
    description: "Discovers and inventories MCP tool calls for audit and risk review.",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "openleash-core",
    entrypoint: "plugins/mcp-scanner",
    stages: ["tool.beforeUse", "tool.afterUse"],
    permissions: ["event:read", "tool:read", "audit:write"],
    effects: ["observe", "inventory"],
    ordering: { priority: 400, after: ["openleash.security-evaluator"] },
    defaultConfig: { enabled: true, redactSecrets: true },
    tags: ["mcp", "inventory", "audit"]
  }
];

export function bundledPluginCatalog(): PluginCatalogItem[] {
  return bundledFirstPartyPlugins.map((plugin) => ({
    ...plugin,
    settings: {
      enabled: true,
      config: plugin.defaultConfig ?? {},
      orderingPriority: plugin.ordering?.priority ?? null
    }
  }));
}
