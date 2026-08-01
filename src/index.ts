export type AgentKind =
  | "claude-code"
  | "codex"
  | "openclaw"
  | "nanoclaw"
  | "salesforce-agentforce"
  | "azure-ai-foundry"
  | "microsoft-copilot-studio"
  | "aws-bedrock-agentcore"
  | "google-vertex-ai"
  | "n8n"
  | "zapier-agents"
  | "openai-codex-cloud"
  | "cursor"
  | "gemini"
  | "opencode"
  | "cline"
  | "continue"
  | "windsurf"
  | "github-copilot"
  | "kiro"
  | "aider"
  | "zed"
  | "unknown";

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "SubagentStart"
  | "SubagentStop"
  | "Notification"
  | "SessionEnd"
  | "Stop";

export type PipelineEvent =
  | "openleash.startup"
  | "agent.detected"
  | "skill.detected"
  | "skill.changed"
  | "skill.removed"
  | "log.emitted"
  | "prompt.beforeSubmit"
  | "provider.request.beforeSend"
  | "plugin.tool.execute"
  | "agent.response"
  | "tool.beforeUse"
  | "tool.afterUse"
  | "session.started"
  | "session.ended";

export type PluginPermission =
  | "event:read"
  | "prompt:read"
  | "prompt:write"
  | "provider-request:read"
  | "provider-request:write"
  | "local-model:run"
  | "tool:read"
  | "decision:write"
  | "model:invoke"
  | "network:access"
  | "instructions:read"
  | "conversation:read"
  | "filesystem:read"
  | "filesystem:write"
  | "storage:read"
  | "storage:write"
  | "audit:write"
  | "log:write"
  | "signal:write"
  | "usage:write"
  | "notification:send"
  | "island:publish";

export type PluginEffect =
  | "observe"
  | "transform"
  | "ask"
  | "deny"
  | "notify"
  | "inventory";

/** Plugins are always isolated OCI containers. */
export type PluginRuntime = "container";

export type PluginContainerPlacement = "edge" | "server" | "either";

export type PluginContainerExecution = {
  type: "container";
  placement: PluginContainerPlacement;
  protocol: "openleash-container-plugin.v1";
  image: string;
  /** Production releases pin the immutable image digest separately from the human-readable tag. */
  digest?: string;
  healthPath?: string;
  /** Generic normalized pipeline-event endpoint. */
  eventPath?: string;
  transformPath?: string;
  toolExecutePath?: string;
  /** Loopback-only port used by the desktop edge runtime; never exposed publicly. */
  edgePort?: number;
  timeoutMs?: number;
  failureMode?: "open" | "closed";
  resources?: {
    memoryMb?: number;
    cpuShares?: number;
  };
  /**
   * shared-trusted is reserved for reviewed images that keep no tenant state in-process.
   * user-dedicated binds one workload and its storage identity to one authenticated user.
   */
  isolation?:
    | "shared-trusted"
    | "user-dedicated"
    | "tenant-dedicated"
    | "customer-hosted";
  storage?: {
    persistent: boolean;
    volumeName?: string;
  };
};

export type PluginOrdering = {
  before?: string[];
  after?: string[];
  priority?: number;
};

export type PluginSettingSchema = {
  type: "object";
  additionalProperties?: boolean;
  properties?: Record<string, unknown>;
  required?: string[];
};

export type OpenLeashPluginManifest = {
  id: string;
  slug?: string;
  name: string;
  description: string;
  repositoryUrl?: string;
  version: string;
  publisher: "openleash" | string;
  runtime: PluginRuntime;
  execution?: PluginContainerExecution;
  /** `cloud-only` plugins are never executed by Individual Open Source or Private Cloud runtimes. */
  executionEnvironment?: "any" | "cloud-only";
  entrypoint: string;
  events: PipelineEvent[];
  permissions: PluginPermission[];
  effects: PluginEffect[];
  ordering?: PluginOrdering;
  configSchema?: PluginSettingSchema;
  defaultConfig?: Record<string, unknown>;
  tags?: string[];
};

export type PluginMarketplaceReviewStatus = "approved" | "pending_review" | "rejected";
export type PluginMarketplaceSource = "first_party" | "community" | "private";

export type PluginMarketplaceListing = OpenLeashPluginManifest & {
  slug: string;
  developerName: string;
  developerUrl?: string;
  source: PluginMarketplaceSource;
  reviewStatus: PluginMarketplaceReviewStatus;
  shortDescription: string;
  longDescription: string;
  heroTagline: string;
  packageUrl?: string;
  repositoryUrl?: string;
  documentationUrl?: string;
  iconText: string;
  visualPng?: string;
  installCount?: number;
  downloadCount?: number;
  weeklyDownloadCount?: number;
  trendPercent?: number;
  rating?: number;
  ratingCount?: number;
  featuredRank?: number | null;
  seoTitle: string;
  seoDescription: string;
  createdAt?: string;
  updatedAt?: string;
};

export type OrganizationPluginPolicy = {
  allowUserMarketplaceInstalls: boolean;
  allowUserCommunityPlugins: boolean;
  mandatoryPluginIds: string[];
  defaultPluginIds: string[];
};

export type PluginCatalogItem = OpenLeashPluginManifest & {
  slug?: string;
  marketplace?: PluginMarketplaceListing;
  settings: PluginSettingState;
  organizationPolicy?: {
    mandatory: boolean;
    defaultEnabled: boolean;
    userInstallAllowed: boolean;
    configLocked?: boolean;
  };
};

export type PluginSettingProfile = {
  /** Stable client-generated identifier used in audit records and container caches. */
  id: string;
  name: string;
  /** Empty means every agent. Matching profiles are merged in ascending priority order. */
  agentKinds: AgentKind[];
  /** Stable enrolled-agent identifiers. Empty means any instance of a matching kind. */
  agentIds?: string[];
  enabled?: boolean;
  config: Record<string, unknown>;
  priority?: number;
};

export type PluginSettingState = {
  enabled: boolean;
  config: Record<string, unknown>;
  /** Profiles editable at the current API scope (organization for admin, user for client). */
  profiles?: PluginSettingProfile[];
  /** Read-only organization profiles inherited by a user. */
  inheritedProfiles?: PluginSettingProfile[];
  /** Profiles selected for the current agent event, when a runtime context is present. */
  effectiveProfileIds?: string[];
  /** False when the selected installed version has no approved executable release. */
  runtimeAvailable?: boolean;
  runtimeError?: string;
  orderingPriority?: number | null;
  installedVersion?: string;
  availableVersion?: string;
  updateAvailable?: boolean;
  updatePolicy?: "manual" | "patch" | "minor" | "locked";
  updatedAt?: string;
};

export function firstPartyEventContainer(
  slug: string,
  version: string,
  options: Partial<PluginContainerExecution> = {},
): PluginContainerExecution {
  const edgePorts: Record<string, number> = {
    "blast-radius": 9351,
    "sensitive-access": 9352,
    "data-leakage-prevention": 9353,
    "rules-enforcer": 9354,
    "mcp-scanner": 9355,
    "code-scanner": 9356,
    "skill-scanner": 9357,
    "siem-exporter": 9358,
  };
  return {
    type: "container",
    placement: "either",
    protocol: "openleash-container-plugin.v1",
    image: `ghcr.io/open-leash/plugin-${slug}:${version}`,
    healthPath: "/healthz",
    eventPath: "/v1/events",
    edgePort: edgePorts[slug],
    timeoutMs: 30_000,
    failureMode: "closed",
    isolation: "shared-trusted",
    resources: { memoryMb: 256, cpuShares: 256 },
    storage: { persistent: true },
    ...options,
  };
}

export const FIRST_PARTY_PLUGIN_MANIFESTS = [
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
      eventPath: "/v1/events",
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
    events: ["provider.request.beforeSend", "plugin.tool.execute"],
    permissions: ["event:read", "prompt:read", "prompt:write", "provider-request:read", "provider-request:write", "local-model:run", "audit:write", "log:write", "usage:write", "island:publish"],
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
    defaultConfig: {
      enabled: false,
      level: "standard",
      conciseResponse: false,
      minimumChars: 1200,
      protectRecent: 2,
      ccrEnabled: false,
      ccrTtlSeconds: 3600
    },
    tags: ["tokens", "cost", "prompt"]
  },
  {
    id: "openleash.skill-scanner",
    slug: "skill-scanner",
    name: "skill-scanner",
    description: "Catch suspicious instructions before they spread.",
    repositoryUrl: "https://github.com/open-leash/plugin-skill-scanner",
    version: "1.0.3",
    publisher: "openleash",
    runtime: "container",
    execution: firstPartyEventContainer("skill-scanner", "1.0.2", {
      digest: "sha256:746f546c26ba5c0ecacbf559f231186f65b8133de1cd5ae4bb0a4c2e6ad740af",
    }),
    entrypoint: "container",
    events: ["openleash.startup", "agent.detected", "skill.detected", "skill.changed"],
    permissions: ["event:read", "filesystem:read", "decision:write", "model:invoke", "audit:write", "log:write", "signal:write", "notification:send"],
    effects: ["observe", "ask", "inventory"],
    ordering: { priority: 150 },
    defaultConfig: {
      enabled: true,
      suspiciousRiskThreshold: 50
    },
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
    runtime: "container",
    execution: firstPartyEventContainer("data-leakage-prevention", "1.0.0", {
      digest: "sha256:df368f0dec7df9022e5f8204730e44660ae8eb56f733a49afd528f8911e25dbe",
    }),
    entrypoint: "container",
    events: ["prompt.beforeSubmit"],
    permissions: ["event:read", "prompt:read", "prompt:write", "decision:write", "model:invoke", "audit:write", "signal:write"],
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
    defaultConfig: {
      enabled: false,
      action: "mask",
      categories: ["pii", "phi", "tokens", "keys", "credentials"]
    },
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
    runtime: "container",
    execution: firstPartyEventContainer("sensitive-access", "1.0.0", {
      digest: "sha256:ca0b01b5f001a624733a0e1417625225806b1f02b73249babf064e24241e75ce",
    }),
    entrypoint: "container",
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
    defaultConfig: {
      enabled: true,
      secretFileAction: "ask",
      envDumpAction: "block",
      exfiltrationAction: "block"
    },
    tags: ["security", "secrets", "credentials", "privacy"]
  },
  {
    id: "openleash.blast-radius",
    slug: "blast-radius",
    name: "blast-radius",
    description: "Block destructive tool use before agents damage files, databases, or infrastructure.",
    repositoryUrl: "https://github.com/open-leash/plugin-blast-radius",
    version: "1.0.2",
    publisher: "openleash",
    runtime: "container",
    execution: firstPartyEventContainer("blast-radius", "1.0.3", {
      digest: "sha256:1c3f8e3063d84d6a1344491c2c2be5635d70f13cbee62362913b03e502b8b10f",
    }),
    entrypoint: "container",
    events: ["prompt.beforeSubmit", "tool.beforeUse"],
    permissions: ["event:read", "prompt:read", "tool:read", "decision:write", "audit:write", "log:write", "signal:write", "island:publish"],
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
    defaultConfig: {
      enabled: true,
      destructiveAction: "block",
      databaseMutationAction: "ask",
      broadFilesystemAction: "block"
    },
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
    runtime: "container",
    execution: firstPartyEventContainer("rules-enforcer", "1.0.0", {
      digest: "sha256:b39fc2580e02d46b20672341278080b57c40e9e8869136c01cb10c98ade9f7f1",
    }),
    entrypoint: "container",
    events: ["prompt.beforeSubmit", "agent.response", "tool.beforeUse", "tool.afterUse"],
    permissions: ["event:read", "prompt:read", "tool:read", "decision:write", "model:invoke", "audit:write", "log:write", "signal:write", "usage:write", "notification:send"],
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
    defaultConfig: {
      enabled: true,
      rules: []
    },
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
    runtime: "container",
    execution: firstPartyEventContainer("mcp-scanner", "1.0.0", {
      digest: "sha256:34d1568441f4b1ba5b5a067cb6ef2c85a8879eaa9581c3f4fac9271ff3200a27",
    }),
    entrypoint: "container",
    events: ["tool.beforeUse", "tool.afterUse"],
    permissions: ["event:read", "tool:read", "audit:write", "signal:write"],
    effects: ["observe", "inventory"],
    ordering: { priority: 400, after: ["openleash.rules-enforcer"] },
    defaultConfig: {
      enabled: true,
      redactSecrets: true
    },
    tags: ["security", "mcp", "inventory", "audit"]
  },
  {
    id: "openleash.siem-exporter",
    slug: "siem-exporter",
    name: "siem-exporter",
    description: "Send agent incidents to your SOC stack.",
    repositoryUrl: "https://github.com/open-leash/plugin-siem-exporter",
    version: "1.0.0",
    publisher: "openleash",
    runtime: "container",
    execution: firstPartyEventContainer("siem-exporter", "1.0.0", {
      digest: "sha256:7d41e5ca00d06ec65e75d9db3f8060ee875c2959afcea1537dc514a424048ba4",
      failureMode: "open",
    }),
    entrypoint: "container",
    events: ["prompt.beforeSubmit", "agent.response", "tool.beforeUse", "tool.afterUse", "session.started", "session.ended", "skill.detected", "skill.changed", "skill.removed", "log.emitted"],
    permissions: ["event:read", "prompt:read", "tool:read", "network:access", "audit:write", "log:write"],
    effects: ["observe", "notify"],
    ordering: { priority: 900, after: ["openleash.rules-enforcer", "openleash.mcp-scanner"] },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        protocol: { enum: ["ecs-json", "splunk-hec", "generic-webhook"] },
        endpointUrl: { type: "string" },
        bearerToken: { type: "string" },
        hecToken: { type: "string" },
        source: { type: "string" },
        sourcetype: { type: "string" },
        index: { type: "string" },
        minSeverity: { enum: ["info", "low", "medium", "high", "critical"] },
        includePrompt: { type: "boolean" },
        includeToolArguments: { type: "boolean" }
      }
    },
    defaultConfig: {
      enabled: false,
      protocol: "ecs-json",
      endpointUrl: "",
      bearerToken: "",
      hecToken: "",
      source: "openleash",
      sourcetype: "openleash:security",
      index: "security",
      minSeverity: "info",
      includePrompt: false,
      includeToolArguments: false
    },
    tags: ["utility", "siem", "soc", "ecs", "splunk", "syslog", "incident-response"]
  }
] satisfies OpenLeashPluginManifest[];

export type PluginRunStatus = "skipped" | "passed" | "modified" | "blocked" | "needs_question" | "failed";

export type PluginFinding = {
  title: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  evidence?: string[];
};

export type PluginRunRecord = {
  pluginId: string;
  event: PipelineEvent;
  status: PluginRunStatus;
  summary: string;
  durationMs?: number;
  findings?: PluginFinding[];
  metadata?: Record<string, unknown>;
};

export type PluginPromptCompressionLevel = "light" | "standard" | "maximum";
export type PluginDlpCategory = "pii" | "phi" | "tokens" | "keys" | "credentials";
export type PluginDlpAction = "block" | "mask";

export type PluginPromptCompressionRequest = {
  prompt: string;
  level: PluginPromptCompressionLevel;
  conciseResponse?: boolean;
  model?: string;
};

export type PluginPromptCompressionConfig = {
  enabled: boolean;
  level: PluginPromptCompressionLevel;
  conciseResponse: boolean;
  model: string;
};

export type PluginPromptCompressionResult = {
  prompt: string;
  model: string;
  originalLength: number;
  compressedLength: number;
  ratio: number;
};

export type PluginDlpInspectionRequest = {
  prompt: string;
  action: PluginDlpAction;
  categories: PluginDlpCategory[];
  model?: string;
};

export type PluginDlpConfig = {
  enabled: boolean;
  action: PluginDlpAction;
  categories: PluginDlpCategory[];
  model: string;
};

export type PluginPromptPipelineConfig = {
  compression: PluginPromptCompressionConfig;
  dlp: PluginDlpConfig;
};

export type PluginDlpInspectionResult = {
  prompt: string;
  blocked: boolean;
  matched: boolean;
  masked: boolean;
  model: string;
  categories: PluginDlpCategory[];
  findings: Array<{ category: PluginDlpCategory; quote: string; reason: string }>;
};

export type PluginPolicyEvaluationRequest = {
  request: EvaluationRequest;
  policies: Policy[];
};

export type PluginPolicyEvaluationResult = {
  results: PolicyDecision[];
  model: string;
};

export type PluginStorageScope = {
  userId?: string;
  agentKind?: string;
  sessionId?: string;
  conversationId?: string;
  projectPath?: string;
  key?: string;
};

export type PluginStorageRead<T = unknown> = {
  key?: string;
  scope?: PluginStorageScope;
  value: T;
  updatedAt: string;
  expiresAt?: string | null;
};

export type PluginStorageGetRequest = {
  key: string;
  scope?: PluginStorageScope;
};

export type PluginStorageSetRequest = {
  key: string;
  value: unknown;
  scope?: PluginStorageScope;
  ttlSeconds?: number;
};

export type PluginStorageListRequest = {
  keyPrefix?: string;
  scope?: PluginStorageScope;
  limit?: number;
};

export type PluginNotificationRequest = {
  level: "info" | "warning" | "critical";
  title: string;
  summary: string;
  dedupeKey?: string;
  scope?: PluginStorageScope;
  minIntervalSeconds?: number;
};

export type PluginNotificationResult = {
  sent: boolean;
  deduped: boolean;
};

export type PluginIslandTone = "neutral" | "info" | "success" | "warning" | "danger";
export type PluginIslandActivityStatus = "queued" | "running" | "waiting" | "completed" | "failed";
export type PluginIslandProgress = { current: number; total?: number; label?: string };

export type PluginIslandAction =
  | { id: string; label: string; type: "open-session" }
  | { id: string; label: string; type: "open-plugin-settings" }
  | { id: string; label: string; type: "open-plugin-outcome"; outcomeId: string };

export type PluginIslandBaseRequest = {
  /** Stable within the plugin. Re-publishing the same key updates the existing contribution. */
  key: string;
  /** Defaults to the current event session. */
  sessionId?: string;
  /** Expiring contributions prevent stale plugin UI. Defaults to 120 seconds. */
  ttlSeconds?: number;
  action?: PluginIslandAction;
};

export type PluginIslandAnnotationRequest = PluginIslandBaseRequest & {
  label: string;
  detail?: string;
  value?: string;
  tone?: PluginIslandTone;
};

export type PluginIslandActivityRequest = PluginIslandBaseRequest & {
  title: string;
  detail?: string;
  status: PluginIslandActivityStatus;
  progress?: PluginIslandProgress;
  tone?: PluginIslandTone;
};

export type PluginIslandStatusRequest = Omit<PluginIslandBaseRequest, "sessionId"> & {
  title: string;
  detail?: string;
  tone?: PluginIslandTone;
  progress?: PluginIslandProgress;
  relatedSessionIds?: string[];
};

export type PluginIslandClearRequest = { key: string; sessionId?: string };
export type PluginIslandPublishRequest =
  | ({ kind: "annotation" } & PluginIslandAnnotationRequest)
  | ({ kind: "activity" } & PluginIslandActivityRequest)
  | ({ kind: "status" } & PluginIslandStatusRequest);

export type PluginIslandContribution = {
  schemaVersion: "2026-07-20.plugin-island.v1";
  id: string;
  pluginId: string;
  kind: PluginIslandPublishRequest["kind"];
  key: string;
  sessionId?: string;
  agentKind?: string;
  /** Host-derived stable enrolled agent runtime identifier when available. */
  agentId?: string;
  projectPath?: string;
  label?: string;
  title?: string;
  detail?: string;
  value?: string;
  tone: PluginIslandTone;
  status?: PluginIslandActivityStatus;
  progress?: PluginIslandProgress;
  action?: PluginIslandAction;
  relatedSessionIds?: string[];
  updatedAt: string;
  expiresAt: string;
};

export type PluginIslandPublishResult = {
  contribution: PluginIslandContribution;
};

export type PluginLogLevel = "debug" | "info" | "warn" | "error" | "security";

export type PluginLogRequest = {
  level: PluginLogLevel;
  message: string;
  code?: string;
  category?: "system" | "plugin" | "security" | "audit";
  data?: Record<string, unknown>;
  scope?: PluginStorageScope;
};

export type PluginLogRecord = {
  id?: string;
  pluginId: string;
  level: PluginLogLevel;
  message: string;
  code?: string;
  category: "system" | "plugin" | "security" | "audit";
  data: Record<string, unknown>;
  scope?: PluginStorageScope;
  createdAt: string;
};

export type PluginSignalKind =
  | "security.finding"
  | "policy.decision"
  | "approval.event"
  | "secret.detected"
  | "tool.risk"
  | "mcp.discovery"
  | "identity.risk"
  | "audit.event"
  | "plugin.health"
  | "export.status";

export type PluginSignalSeverity = "info" | "low" | "medium" | "high" | "critical";

export type PluginSignalRequest = {
  kind: PluginSignalKind;
  severity?: PluginSignalSeverity;
  title: string;
  summary?: string;
  decision?: "allow" | "ask" | "deny" | "blocked" | "approved" | "rejected" | "observed";
  status?: string;
  target?: {
    type?: string;
    name?: string;
    id?: string;
  };
  evidence?: unknown;
  details?: Record<string, unknown>;
  correlationKeys?: string[];
  occurredAt?: string;
};

export type PluginSignalRecord = PluginSignalRequest & {
  id?: string;
  pluginId: string;
  organizationId?: string;
  conversationEventId?: string;
  userId?: string;
  computerId?: string;
  agentRuntimeId?: string;
  agentKind?: string;
  sessionId?: string;
  projectPath?: string;
  createdAt: string;
};

export type OpenLeashOutcomeDomain =
  | "security"
  | "data_protection"
  | "tool_risk"
  | "identity"
  | "cost"
  | "productivity"
  | "compliance"
  | "operations";

export type OpenLeashOutcomeStatus =
  | "observed"
  | "passed"
  | "modified"
  | "masked"
  | "blocked"
  | "needs_review"
  | "failed";

export type OpenLeashOutcomeDecision =
  | "allow"
  | "ask"
  | "deny"
  | "blocked"
  | "approved"
  | "rejected"
  | "observed";

export type OpenLeashOutcomeEvidence = {
  label: string;
  value?: string;
  kind?: "text" | "code" | "path" | "url" | "json";
  sensitive?: boolean;
};

export type OpenLeashOutcomeRecord = {
  id: string;
  domain: OpenLeashOutcomeDomain;
  title: string;
  summary?: string | null;
  severity: PluginSignalSeverity;
  status: OpenLeashOutcomeStatus;
  decision?: OpenLeashOutcomeDecision | null;
  occurredAt: string;
  createdAt: string;
  source: {
    pluginId: string;
    label: string;
    kind: PluginSignalKind | PluginUsageKind | "plugin.run" | "plugin.log";
  };
  subject?: {
    type?: string;
    name?: string;
    id?: string;
  };
  actor?: {
    userId?: string | null;
    name?: string | null;
    email?: string | null;
  };
  agent?: {
    kind?: string | null;
    name?: string | null;
    hostname?: string | null;
  };
  context?: {
    organizationId?: string;
    organizationSlug?: string;
    conversationEventId?: string | null;
    evaluationId?: string | null;
    eventName?: string | null;
    toolName?: string | null;
    projectPath?: string | null;
    correlationKeys?: string[];
  };
  evidence?: OpenLeashOutcomeEvidence[];
  details?: Record<string, unknown>;
};

export type OpenLeashPluginCategoryId = "cost" | "security" | "observability" | "utility";

export type OpenLeashPluginCategoryMeta = {
  id: OpenLeashPluginCategoryId;
  label: string;
  color: string;
  icon: "trend" | "shield" | "eye" | "bolt";
};

export const OPENLEASH_PLUGIN_CATEGORIES: OpenLeashPluginCategoryMeta[] = [
  { id: "observability", label: "Visibility", color: "#2a63d8", icon: "eye" },
  { id: "cost", label: "Cost", color: "#5b47e0", icon: "trend" },
  { id: "security", label: "Security", color: "#0b7968", icon: "shield" },
  { id: "utility", label: "Other", color: "#a15b12", icon: "bolt" }
];

export type OpenLeashClientPluginView = {
  id: string;
  packageId: string;
  displayName: string;
  description?: string;
  category: OpenLeashPluginCategoryId;
  installed: boolean;
  author?: string;
  iconText?: string;
  downloadCount?: number;
  configSchema?: PluginSettingSchema;
  defaultConfig?: Record<string, unknown>;
  settings?: PluginSettingState;
  organizationPolicy?: PluginCatalogItem["organizationPolicy"];
  outcomeCount: number;
  latestOutcome?: OpenLeashOutcomeRecord;
};

export type OpenLeashClientPluginCategory = OpenLeashPluginCategoryMeta & {
  count: number;
  plugins: OpenLeashClientPluginView[];
};

export type OpenLeashClientViewModel = {
  version: "2026-06-26.client-view-model.v1";
  generatedAt: string;
  shellSections: Array<"overview" | "agents" | "activity" | "approvals" | "policies" | "settings" | "identity">;
  pluginCategories: OpenLeashClientPluginCategory[];
  outcomes: OpenLeashOutcomeRecord[];
  summary?: {
    total?: number;
    totalOutcomes: number;
    highSeverity: number;
    blocked: number;
    needsReview: number;
    byDomain: Record<string, number>;
  };
};

export function pluginPackageId(plugin: Pick<PluginCatalogItem, "id" | "slug" | "name" | "marketplace">) {
  return plugin.slug || plugin.marketplace?.slug || String(plugin.id || "").split(".").pop() || plugin.name || plugin.id;
}

export function pluginCategoryId(plugin: Pick<PluginCatalogItem, "id" | "name" | "description" | "tags" | "marketplace"> & { category?: unknown; manifest?: { category?: unknown } }): OpenLeashPluginCategoryId {
  const raw = (plugin.marketplace as { category?: unknown } | undefined)?.category || plugin.category || plugin.manifest?.category || "";
  const text = String(raw || `${plugin.id || ""} ${plugin.name || ""} ${plugin.description || ""} ${(plugin.marketplace?.tags || []).join(" ")} ${(plugin.tags || []).join(" ")}`).toLowerCase();
  if (/siem-exporter/.test(text)) return "utility";
  if (/mcp-scanner|skill-scanner/.test(text)) return "security";
  if (/security|policy|guard|skill|prompt-injection|risk|approval|dlp|leak|sensitive|secret|credential/.test(text)) return "security";
  if (/visibility|observability|observe|log|mcp|siem|audit|telemetry|monitor/.test(text)) return "observability";
  if (/cost|token|compression|usage|budget|spend/.test(text)) return "cost";
  return "utility";
}

export function buildOpenLeashClientViewModel({
  plugins,
  outcomes,
  summary,
  shellSections = ["overview", "agents", "activity", "approvals", "policies", "settings"]
}: {
  plugins: PluginCatalogItem[];
  outcomes: OpenLeashOutcomeRecord[];
  summary?: Partial<OpenLeashClientViewModel["summary"]>;
  shellSections?: OpenLeashClientViewModel["shellSections"];
}): OpenLeashClientViewModel {
  const outcomesByPlugin = new Map<string, OpenLeashOutcomeRecord[]>();
  for (const outcome of outcomes) {
    const pluginId = outcome.source?.pluginId || "openleash";
    const list = outcomesByPlugin.get(pluginId) || [];
    list.push(outcome);
    outcomesByPlugin.set(pluginId, list);
  }
  const installed = plugins
    .filter((plugin) => plugin.settings?.enabled === true)
    .map((plugin): OpenLeashClientPluginView => {
      const pluginOutcomes = outcomesByPlugin.get(plugin.id) || [];
      return {
        id: plugin.id,
        packageId: pluginPackageId(plugin),
        // A plugin's package slug is its product-facing identity. Do not turn
        // it into a title-cased product name in clients.
        displayName: pluginPackageId(plugin),
        description: plugin.marketplace?.shortDescription || plugin.description,
        category: pluginCategoryId(plugin),
        installed: true,
        author: plugin.marketplace?.developerName || plugin.publisher,
        iconText: plugin.marketplace?.iconText,
        downloadCount: plugin.marketplace?.downloadCount,
        configSchema: plugin.configSchema,
        defaultConfig: plugin.defaultConfig,
        settings: plugin.settings,
        organizationPolicy: plugin.organizationPolicy,
        outcomeCount: pluginOutcomes.length,
        latestOutcome: pluginOutcomes[0]
      };
    });
  return {
    version: "2026-06-26.client-view-model.v1",
    generatedAt: new Date().toISOString(),
    shellSections,
    pluginCategories: OPENLEASH_PLUGIN_CATEGORIES.map((category) => {
      const categoryPlugins = installed.filter((plugin) => plugin.category === category.id);
      return { ...category, count: categoryPlugins.length, plugins: categoryPlugins };
    }),
    outcomes,
    summary: clientViewSummary(outcomes, summary)
  };
}

function clientViewSummary(outcomes: OpenLeashOutcomeRecord[], summary?: Partial<OpenLeashClientViewModel["summary"]>): NonNullable<OpenLeashClientViewModel["summary"]> {
  const fallback = {
    totalOutcomes: outcomes.length,
    highSeverity: outcomes.filter((item) => item.severity === "high" || item.severity === "critical").length,
    blocked: outcomes.filter((item) => item.status === "blocked" || item.decision === "blocked" || item.decision === "deny").length,
    needsReview: outcomes.filter((item) => item.status === "needs_review" || item.decision === "ask").length,
    byDomain: outcomes.reduce<Record<string, number>>((acc, item) => {
      acc[item.domain] = (acc[item.domain] ?? 0) + 1;
      return acc;
    }, {})
  };
  return {
    totalOutcomes: summary?.totalOutcomes ?? summary?.total ?? fallback.totalOutcomes,
    highSeverity: summary?.highSeverity ?? fallback.highSeverity,
    blocked: summary?.blocked ?? fallback.blocked,
    needsReview: summary?.needsReview ?? fallback.needsReview,
    byDomain: summary?.byDomain ?? fallback.byDomain
  };
}

export type PluginUsageKind = "llm.tokens" | "plugin.compute" | "plugin.operation" | "network.egress" | "storage.bytes";

export type PluginUsageRecordRequest = {
  kind: PluginUsageKind;
  quantity?: number;
  unit?: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  savedTokens?: number;
  estimatedCostUsd?: number;
  details?: Record<string, unknown>;
  occurredAt?: string;
};

export type PluginUsageRecord = PluginUsageRecordRequest & {
  id?: string;
  pluginId: string;
  organizationId?: string;
  conversationEventId?: string;
  userId?: string;
  computerId?: string;
  agentRuntimeId?: string;
  agentKind?: string;
  sessionId?: string;
  projectPath?: string;
  createdAt: string;
};

export type PluginInstructionFile = {
  agent: string;
  scope: "global" | "project";
  label?: string;
  path?: string;
  content: string;
  parsedLines?: string[];
};

export type PluginInstructionListRequest = {
  agent?: string;
  scope?: "global" | "project";
};

export type PluginConversationRecentRequest = {
  /** Bounded by the runtime. Defaults to 20 and never exceeds 100. */
  limit?: number;
};

export type PluginConversationContext = {
  sessionId: string;
  turns: ConversationTurn[];
  /** True when older turns exist outside the returned bounded window. */
  truncated: boolean;
};

export type PluginLlmJsonRequest = {
  system?: string;
  prompt: string;
  schema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  purpose?: string;
};

export type PluginLlmJsonResult<T = unknown> = {
  json: T;
  model: string;
  provider: string;
  source: "tenant-byok" | "openleash-managed" | "heuristic";
};

export type PluginCapabilities = {
  context: {
    instructions: {
      list(request?: PluginInstructionListRequest): Promise<PluginInstructionFile[]>;
    };
    conversation: {
      /**
       * Returns only the authenticated current session. A plugin cannot select
       * another user, organization, or arbitrary session through this API.
       */
      recent(request?: PluginConversationRecentRequest): Promise<PluginConversationContext>;
    };
  };
  llm: {
    evaluateJson<T = unknown>(request: PluginLlmJsonRequest): Promise<PluginLlmJsonResult<T> | undefined>;
  };
  storage: {
    get<T = unknown>(request: PluginStorageGetRequest): Promise<PluginStorageRead<T> | undefined>;
    set(request: PluginStorageSetRequest): Promise<PluginStorageRead>;
    list<T = unknown>(request?: PluginStorageListRequest): Promise<Array<PluginStorageRead<T>>>;
    delete(request: PluginStorageGetRequest): Promise<void>;
  };
  notification: {
    send(request: PluginNotificationRequest): Promise<PluginNotificationResult>;
  };
  island: {
    annotateSession(request: PluginIslandAnnotationRequest): Promise<PluginIslandPublishResult>;
    reportActivity(request: PluginIslandActivityRequest): Promise<PluginIslandPublishResult>;
    publishStatus(request: PluginIslandStatusRequest): Promise<PluginIslandPublishResult>;
    clear(request: PluginIslandClearRequest): Promise<void>;
  };
  log: {
    emit(request: PluginLogRequest): Promise<PluginLogRecord>;
  };
  signals: {
    emit(request: PluginSignalRequest): Promise<PluginSignalRecord>;
  };
  usage: {
    record(request: PluginUsageRecordRequest): Promise<PluginUsageRecord>;
  };
};

export type OpenLeashEvent = {
  eventName: HookEventName;
  agentKind: AgentKind;
  agentVersion?: string;
  sessionId: string;
  projectPath?: string;
  transcript?: ConversationTurn[];
  tool?: {
    name: string;
    input?: unknown;
    output?: unknown;
  };
  prompt?: string;
  raw?: unknown;
  occurredAt: string;
};

export type McpToolCall = {
  serverName: string;
  toolName: string;
  fullToolName: string;
  arguments: unknown;
  argumentSummary: string;
};

export type ConversationTurn = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  at?: string;
};

export type Policy = {
  id: string;
  name: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  naturalLanguageRule: string;
  enabled: boolean;
  locked?: boolean;
  enforcementAction?: "ask" | "block";
};

export type PolicyDecision = {
  policyId: string;
  policyName: string;
  status: "passed" | "failed" | "needs_question";
  severity: Policy["severity"];
  explanation: string;
  evidence?: string[];
  question?: string;
};

export type EvaluationRequest = {
  computer: {
    hostname: string;
    platform: string;
    osRelease?: string;
  };
  agent: {
    kind: AgentKind;
    displayName: string;
    instanceId?: string;
    version?: string;
    executablePath?: string;
  };
  event: OpenLeashEvent;
};

/** Transport-independent event contract used by hooks, the local proxy and pullers. */
export type AgentEventSource = "api_hook" | "local_proxy" | "provider_puller";

export type AgentEventCapabilities = {
  observe: true;
  block: boolean;
  rewritePrompt: boolean;
  rewriteToolInput: boolean;
  rewriteResponse: boolean;
};

export type NormalizedAgentEvent = {
  schemaVersion: "2026-07-12.v1";
  idempotencyKey: string;
  correlationId?: string;
  source: AgentEventSource;
  provider: string;
  capabilities: AgentEventCapabilities;
  request: EvaluationRequest;
  receivedAt?: string;
};

export type NormalizedAgentEventResult = EvaluationResponse & {
  deduplicated: boolean;
  source: AgentEventSource;
  finalPrompt?: string;
};

export type EvaluationResponse = {
  decision: "allow" | "deny" | "ask";
  decisionId: string;
  summary: string;
  resolutionGuidance?: string;
  /** Agent-native interaction data returned after a human answers in an OpenLeash client. */
  resolutionPayload?: Record<string, unknown>;
  question?: string;
  results: PolicyDecision[];
};

export type OpenLeashAttentionEvent = {
  schemaVersion: "2026-07-19.v1";
  id: string;
  decisionId?: string;
  kind:
    | "approval"
    | "question"
    | "plan_review"
    | "completed"
    | "subagent_completed"
    | "blocked";
  state: "waiting" | "resolved";
  title: string;
  body?: string;
  createdAt: string;
  agent: { kind: string; name: string; hostname: string };
  session: { id: string; projectPath?: string };
  interaction?:
    | { type: "approval" }
    | {
        type: "questions";
        originalInput: Record<string, unknown>;
        questions: Array<{
          question: string;
          header?: string;
          multiSelect: boolean;
          options: Array<{ label: string; description?: string }>;
        }>;
      }
    | {
        type: "plan";
        markdown?: string;
        originalInput: Record<string, unknown>;
      };
};

export type MobileIdentityProvider = {
  id: string;
  type: "google" | "google_workspace" | "github" | "okta" | "azure_ad" | "ping" | "oidc" | "custom";
  label: string;
  organizationId?: string;
  organizationSlug?: string;
  authorizationUrl?: string;
};

export type MobileBootstrapResponse = {
  mode: OpenLeashClientMode;
  apiUrl: string;
  cloudApiUrl: string;
  providers: MobileIdentityProvider[];
  organization?: {
    id: string;
    name: string;
    slug: string;
    region?: string | null;
  };
};

export type MobileAuthStartRequest = {
  audience?: "individual" | "organization";
  organizationSlug?: string;
  organizationId?: string;
  providerType?: MobileIdentityProvider["type"];
  redirectUri: string;
};

export type MobileAuthStartResponse = {
  authorizationUrl: string;
  state: string;
  providerType: MobileIdentityProvider["type"];
  organizationId?: string;
};

export type MobileAuthExchangeRequest = {
  audience?: "individual" | "organization";
  organizationId?: string;
  organizationSlug?: string;
  providerType: MobileIdentityProvider["type"];
  authorizationCode?: string;
  idToken?: string;
  redirectUri: string;
  provisionUser?: boolean;
};

export type MobileAuthExchangeResponse = {
  success: boolean;
  tokens: {
    accessToken: string;
    expiresAt: string;
  };
  user: {
    id: string;
    email: string;
    display_name: string;
    role: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    region?: string | null;
  };
  authMode: "sso" | "google" | "development";
};

export type MobileDeviceRegisterRequest = {
  platform: "ios" | "android" | "web" | "unknown";
  pushToken?: string;
  deviceName?: string;
  appVersion?: string;
};

export type MobilePendingApproval = {
  id: string;
  attention_kind: "approval" | "question" | "plan_review";
  interaction?: OpenLeashAttentionEvent["interaction"];
  summary: string;
  question?: string;
  created_at: string;
  agent_name: string;
  agent_kind: AgentKind;
  project_path?: string | null;
  project_name?: string | null;
  primary_policy?: string | null;
  quote?: string | null;
  purpose_summary?: string | null;
  recent_context?: Array<{
    role: ConversationTurn["role"];
    content: string;
    at?: string;
  }>;
  triggered_policies: Array<{
    policy_name: string;
    status: string;
    severity: string;
    explanation: string;
    evidence?: string[];
  }>;
};

export type MobileStateResponse = {
  user: MobileAuthExchangeResponse["user"];
  organization: MobileAuthExchangeResponse["organization"];
  apiUrl: string;
  mode: OpenLeashClientMode;
  pendingApprovals: MobilePendingApproval[];
  attentionEvents: OpenLeashAttentionEvent[];
  clientConfig: {
    approvalNotifications: boolean;
    managedByOrganization: boolean;
  };
};

export type OpenLeashClientSyncEvent = {
  schemaVersion: "2026-07-27.client-sync.v1";
  id: string;
  kind:
    | "activity.created"
    | "interaction.created"
    | "interaction.resolved";
  occurredAt: string;
};

export type MobileDecisionResolveRequest = {
  resolution: "allow" | "deny";
  resolutionGuidance?: string;
  /** Structured response for agent-native questions and plan review. */
  response?: Record<string, unknown>;
};

export type MobileDecisionResolveResponse = {
  id: string;
  decision: "ask";
  resolution: "allow" | "deny";
  resolution_guidance?: string | null;
  resolved_at: string;
} | null;

export type HookAgentSlug =
  | "claude"
  | "codex"
  | "copilot"
  | "cursor"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "nanoclaw";

export const HOOK_AGENT_METADATA: Record<HookAgentSlug, { kind: AgentKind; displayName: string }> = {
  claude: { kind: "claude-code", displayName: "Claude Code" },
  codex: { kind: "codex", displayName: "OpenAI Codex" },
  copilot: { kind: "github-copilot", displayName: "GitHub Copilot" },
  cursor: { kind: "cursor", displayName: "Cursor" },
  gemini: { kind: "gemini", displayName: "Google Gemini CLI" },
  opencode: { kind: "opencode", displayName: "OpenCode" },
  openclaw: { kind: "openclaw", displayName: "OpenClaw" },
  nanoclaw: { kind: "nanoclaw", displayName: "NanoClaw" }
};

export type HookContextQuery = {
  user_token?: string;
  token?: string;
  agent_version?: string;
  client_version?: string;
  hostname?: string;
  platform?: string;
  os_release?: string;
};

export const OPENLEASH_API_FUNCTION_HEADER = "x-openleash-api-function";
export const OPENLEASH_API_VERSION_HEADER = "x-openleash-api-version";

export const OPENLEASH_API_CONTRACTS = {
  health: "2026-05-16.health.v1",
  tenantEnroll: "2026-05-16.tenant-enroll.v1",
  tenantEvaluate: "2026-05-16.tenant-evaluate.v1",
  tenantHookEvaluate: "2026-05-22.tenant-hook-evaluate.v1",
  tenantDecisionPoll: "2026-05-16.tenant-decision-poll.v1",
  tenantDecisionResolve: "2026-05-16.tenant-decision-resolve.v1",
  tenantTrayStatus: "2026-05-16.tenant-tray-status.v1",
  tenantSkillObservation: "2026-05-27.tenant-skill-observation.v1",
  tenantPluginsRead: "2026-06-20.tenant-plugins-read.v1",
  desktopEnroll: "2026-06-03.desktop-enroll.v1",
  adminOverview: "2026-05-16.admin-overview.v1",
  adminSecurity: "2026-06-22.admin-security.v1",
  adminOutcomes: "2026-06-24.admin-outcomes.v1",
  adminMcpServers: "2026-05-27.admin-mcp-servers.v1",
  adminMcpServerDetail: "2026-05-27.admin-mcp-server-detail.v1",
  adminSkills: "2026-05-27.admin-skills.v1",
  adminPluginsRead: "2026-06-20.admin-plugins-read.v1",
  adminPluginsWrite: "2026-06-20.admin-plugins-write.v1",
  adminLogs: "2026-06-03.admin-logs.v1",
  adminLogDetail: "2026-06-03.admin-log-detail.v1",
  adminTriggers: "2026-05-16.admin-triggers.v1",
  adminTriggerDetail: "2026-05-16.admin-trigger-detail.v1",
  adminEventDetail: "2026-05-16.admin-event-detail.v1",
  adminExternalAgents: "2026-05-16.admin-external-agents.v1",
  adminExternalAgentsSync: "2026-05-16.admin-external-agents-sync.v1",
  adminProviderUsageRead: "2026-06-09.admin-provider-usage-read.v1",
  adminProviderUsageWrite: "2026-06-09.admin-provider-usage-write.v1",
  adminProviderUsageSync: "2026-06-09.admin-provider-usage-sync.v1",
  adminOnboardingRead: "2026-05-16.admin-onboarding-read.v1",
  adminOnboardingWrite: "2026-05-16.admin-onboarding-write.v1",
  adminIdentityRead: "2026-05-16.admin-identity-read.v1",
  adminUsersWrite: "2026-05-16.admin-users-write.v1",
  adminDeploymentTokensRead: "2026-05-16.admin-deployment-tokens-read.v1",
  adminDeploymentTokensWrite: "2026-05-16.admin-deployment-tokens-write.v1",
  adminPoliciesRead: "2026-05-16.admin-policies-read.v1",
  adminPoliciesWrite: "2026-05-16.admin-policies-write.v1",
  adminPromptTransformsRead: "2026-06-06.admin-prompt-transforms-read.v1",
  adminPromptTransformsWrite: "2026-06-06.admin-prompt-transforms-write.v1",
  authSession: "2026-05-16.auth-session.v1",
  authAccountOutcomes: "2026-06-24.auth-account-outcomes.v1",
  authLogout: "2026-05-16.auth-logout.v1",
  authSsoAuthorize: "2026-05-16.auth-sso-authorize.v1",
  authSsoCallback: "2026-05-16.auth-sso-callback.v1",
  authGoogleCallback: "2026-05-24.auth-google-callback.v1",
  mobileBootstrap: "2026-05-22.mobile-bootstrap.v1",
  mobileAuthStart: "2026-05-22.mobile-auth-start.v1",
  mobileAuthExchange: "2026-05-22.mobile-auth-exchange.v1",
  mobileModelKey: "2026-05-23.mobile-model-key.v1",
  mobileDeviceRegister: "2026-05-22.mobile-device-register.v1",
  mobileState: "2026-05-22.mobile-state.v1",
  mobileDecisionResolve: "2026-05-22.mobile-decision-resolve.v1",
  clientNotifications: "2026-06-28.client-notifications.v1",
  clientEvents: "2026-07-27.client-events.v1",
  clientDecisionResolve: "2026-06-28.client-decision-resolve.v1",
  sessionMonitoring: "2026-07-29.session-monitoring.v1",
  organizationsRead: "2026-05-16.organizations-read.v1",
  organizationsWrite: "2026-05-16.organizations-write.v1",
  organizationSsoProviders: "2026-05-16.organization-sso-providers.v1",
  clientUpdateCheck: "2026-05-16.client-update-check.v1",
  clientUpdateLatest: "2026-05-16.client-update-latest.v1",
  clientReleasePublish: "2026-05-16.client-release-publish.v1",
  localEvaluate: "2026-05-16.local-evaluate.v1",
  localHookEvaluate: "2026-05-22.local-hook-evaluate.v1"
} as const;

export type OpenLeashApiFunction = keyof typeof OPENLEASH_API_CONTRACTS;

export function apiVersionHeaders(functionName: OpenLeashApiFunction): Record<string, string> {
  return {
    [OPENLEASH_API_FUNCTION_HEADER]: functionName,
    [OPENLEASH_API_VERSION_HEADER]: OPENLEASH_API_CONTRACTS[functionName]
  };
}

export function apiContractFor(functionName: OpenLeashApiFunction) {
  return {
    functionName,
    version: OPENLEASH_API_CONTRACTS[functionName]
  };
}

export type OpenLeashEdition = "managed-cloud" | "managed-self-hosted";

export type OpenLeashClientMode = "community" | "cloud" | "enterprise";

export type BillingMode =
  | "none"
  | "external";

export type DeploymentMode =
  | "openleash-cloud"
  | "self-hosted-private";

export type DataStoreMode =
  | "postgres";

export type EditionCapabilities = {
  edition: OpenLeashEdition;
  deploymentMode: DeploymentMode;
  billingMode: BillingMode;
  dashboard: "ciso-dashboard";
  endUserControls: "tray-and-approvals-only";
  rulesManagedBy: "admin-dashboard";
  identity: "sso-oauth";
  modelKey: "byok-tenant" | "managed";
  dataStore: DataStoreMode;
  mdmDeployment: boolean;
  automaticUpdates: boolean;
};

const MCP_TOOL_PATTERNS = [
  /^mcp__([A-Za-z0-9_.-]+)__(.+)$/i,
  /^mcp[:.]([A-Za-z0-9_.-]+)[:.](.+)$/i
];

const SECRET_ARGUMENT_KEY = /(api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|credential|password|private[_-]?key|refresh[_-]?token|secret|session[_-]?token|token)/i;

export function parseMcpToolName(toolName?: string): Pick<McpToolCall, "serverName" | "toolName" | "fullToolName"> | undefined {
  const name = String(toolName ?? "").trim();
  if (!name) return undefined;
  for (const pattern of MCP_TOOL_PATTERNS) {
    const match = name.match(pattern);
    if (match?.[1] && match[2]) {
      return {
        serverName: normalizeMcpServerName(match[1]),
        toolName: match[2],
        fullToolName: name
      };
    }
  }
  return undefined;
}

export function mcpToolCallFromEvent(event: OpenLeashEvent): McpToolCall | undefined {
  const parsed =
    parseMcpToolName(event.tool?.name) ??
    mcpToolCallFromRaw(event.raw);
  if (!parsed) return undefined;
  const args = redactMcpArguments(event.tool?.input ?? rawToolInput(event.raw) ?? {});
  return {
    ...parsed,
    arguments: args,
    argumentSummary: summarizeMcpArguments(args)
  };
}

export function redactMcpArguments(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactMcpArguments(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
        key,
        SECRET_ARGUMENT_KEY.test(key) ? "[REDACTED]" : redactMcpArguments(item, depth + 1)
      ])
    );
  }
  if (typeof value === "string") return value.length > 800 ? `${value.slice(0, 800)}...` : value;
  return value;
}

export function summarizeMcpArguments(value: unknown): string {
  if (!value || typeof value !== "object") return value === undefined ? "" : String(value).slice(0, 180);
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 4);
  if (entries.length === 0) return "No arguments";
  return entries.map(([key, item]) => `${key}: ${argumentValuePreview(item)}`).join(" · ").slice(0, 240);
}

function argumentValuePreview(value: unknown): string {
  if (value === "[REDACTED]") return "[REDACTED]";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value.length > 54 ? `${value.slice(0, 54)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  return "{...}";
}

function normalizeMcpServerName(value: string) {
  return value.trim().replace(/\s+/g, "-").slice(0, 160);
}

function rawToolInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const tool = record.tool && typeof record.tool === "object" ? record.tool as Record<string, unknown> : undefined;
  return record.tool_input ?? record.toolInput ?? tool?.input ?? record.input;
}

function mcpToolCallFromRaw(raw: unknown): Pick<McpToolCall, "serverName" | "toolName" | "fullToolName"> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const serverName =
    record.mcp_server ??
    record.mcpServer ??
    record.server_name ??
    record.serverName ??
    (record.tool && typeof record.tool === "object" ? (record.tool as Record<string, unknown>).serverName : undefined);
  const toolName =
    record.tool_name ??
    record.toolName ??
    (record.tool && typeof record.tool === "object" ? (record.tool as Record<string, unknown>).name : undefined);
  if (typeof serverName !== "string" || typeof toolName !== "string") return undefined;
  return {
    serverName: normalizeMcpServerName(serverName),
    toolName,
    fullToolName: parseMcpToolName(toolName)?.fullToolName ?? `mcp__${normalizeMcpServerName(serverName)}__${toolName}`
  };
}

export const EDITION_CAPABILITIES: Record<OpenLeashEdition, EditionCapabilities[]> = {
  "managed-cloud": [
    {
      edition: "managed-cloud",
      deploymentMode: "openleash-cloud",
      billingMode: "external",
      dashboard: "ciso-dashboard",
      endUserControls: "tray-and-approvals-only",
      rulesManagedBy: "admin-dashboard",
      identity: "sso-oauth",
      modelKey: "byok-tenant",
      dataStore: "postgres",
      mdmDeployment: true,
      automaticUpdates: true
    }
  ],
  "managed-self-hosted": [
    {
      edition: "managed-self-hosted",
      deploymentMode: "self-hosted-private",
      billingMode: "none",
      dashboard: "ciso-dashboard",
      endUserControls: "tray-and-approvals-only",
      rulesManagedBy: "admin-dashboard",
      identity: "sso-oauth",
      modelKey: "byok-tenant",
      dataStore: "postgres",
      mdmDeployment: true,
      automaticUpdates: true
    }
  ]
};
