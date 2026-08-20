import { LEASH_FEATURE_PRESENTATIONS, firstPartyFeature, type OpenLeashPluginManifest } from "@openleash/shared";

export const mcpScannerManifest: OpenLeashPluginManifest = {
  id: "openleash.mcp-scanner",
  name: LEASH_FEATURE_PRESENTATIONS["mcp-scanner"].name,
  description: LEASH_FEATURE_PRESENTATIONS["mcp-scanner"].description,
  repositoryUrl: "https://github.com/open-leash/plugin-mcp-scanner",
  version: "1.0.0",
  publisher: "openleash",
  runtime: "builtin",
  execution: firstPartyFeature("mcp-scanner", "1.0.0"),
  entrypoint: "client-api",
  events: ["tool.beforeUse", "tool.afterUse"],
  permissions: ["event:read", "tool:read", "audit:write", "signal:write"],
  effects: ["observe", "inventory"],
  ordering: {
    priority: 400,
    after: ["openleash.rules-enforcer"]
  },
  defaultConfig: {
    enabled: true,
    redactSecrets: true
  },
  tags: ["security", "mcp", "inventory", "audit"]
};
