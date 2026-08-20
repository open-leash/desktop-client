import { LEASH_FEATURE_PRESENTATIONS, firstPartyFeature, type OpenLeashPluginManifest } from "@openleash/shared";

export const skillScannerManifest: OpenLeashPluginManifest = {
  id: "openleash.skill-scanner",
  name: LEASH_FEATURE_PRESENTATIONS["skill-scanner"].name,
  description: LEASH_FEATURE_PRESENTATIONS["skill-scanner"].description,
  repositoryUrl: "https://github.com/open-leash/plugin-skill-scanner",
  version: "1.0.2",
  publisher: "openleash",
  runtime: "builtin",
  execution: firstPartyFeature("skill-scanner", "1.0.2"),
  entrypoint: "client-api",
  events: ["openleash.startup", "agent.detected", "skill.detected", "skill.changed"],
  permissions: ["event:read", "filesystem:read", "decision:write", "model:invoke", "audit:write", "log:write", "signal:write", "notification:send"],
  effects: ["observe", "ask", "inventory"],
  ordering: {
    priority: 150
  },
  defaultConfig: {
    enabled: true,
    suspiciousRiskThreshold: 50
  },
  tags: ["skills", "security", "inventory"]
};
