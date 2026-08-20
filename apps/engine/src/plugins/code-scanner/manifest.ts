import { LEASH_FEATURE_PRESENTATIONS, firstPartyFeature, type AgentKind, type OpenLeashPluginManifest } from "@openleash/shared";

export const CODE_SCANNER_AGENT_KINDS: AgentKind[] = [
  "claude-code",
  "codex",
  "openai-codex-cloud",
  "cursor",
  "github-copilot",
  "gemini",
  "opencode",
  "cline",
  "continue",
  "windsurf",
  "kiro",
  "aider",
  "zed",
];

export const codeScannerManifest: OpenLeashPluginManifest & {
  agentKinds: AgentKind[];
} = {
  id: "openleash.code-scanner",
  slug: "code-scanner",
  name: LEASH_FEATURE_PRESENTATIONS["code-scanner"].name,
  description: LEASH_FEATURE_PRESENTATIONS["code-scanner"].description,
  repositoryUrl: "https://github.com/open-leash/plugin-code-scanner",
  version: "1.0.0",
  publisher: "openleash",
  runtime: "builtin",
  execution: firstPartyFeature("code-scanner", "1.0.0"),
  entrypoint: "client-api",
  events: ["agent.response", "tool.beforeUse"],
  agentKinds: CODE_SCANNER_AGENT_KINDS,
  permissions: [
    "event:read",
    "tool:read",
    "model:invoke",
    "audit:write",
    "log:write",
    "signal:write",
    "notification:send",
  ],
  effects: ["observe", "notify"],
  ordering: { priority: 260, before: ["openleash.rules-enforcer"] },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      notificationRiskThreshold: { type: "number", minimum: 0, maximum: 100 },
      minimumCodeCharacters: { type: "number", minimum: 40, maximum: 4000 },
    },
  },
  defaultConfig: {
    enabled: true,
    notificationRiskThreshold: 70,
    minimumCodeCharacters: 80,
  },
  tags: ["security", "code", "vulnerabilities", "vibe-coding", "notifications"],
};
