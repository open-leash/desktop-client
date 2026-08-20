import { LEASH_FEATURE_PRESENTATIONS, firstPartyFeature, type OpenLeashPluginManifest } from "@openleash/shared";

export const securityEvaluatorManifest: OpenLeashPluginManifest = {
  id: "openleash.rules-enforcer",
  name: LEASH_FEATURE_PRESENTATIONS["rules-enforcer"].name,
  description: LEASH_FEATURE_PRESENTATIONS["rules-enforcer"].description,
  repositoryUrl: "https://github.com/open-leash/plugin-rules-enforcer",
  version: "1.0.0",
  publisher: "openleash",
  runtime: "builtin",
  execution: firstPartyFeature("rules-enforcer", "1.0.0"),
  entrypoint: "client-api",
  events: ["prompt.beforeSubmit", "agent.response", "tool.beforeUse", "tool.afterUse"],
  permissions: ["event:read", "prompt:read", "tool:read", "decision:write", "model:invoke", "audit:write", "log:write", "signal:write", "usage:write", "notification:send"],
  effects: ["observe", "ask", "deny"],
  ordering: {
    priority: 300,
    after: ["openleash.dlp"]
  },
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
            action: { type: "string", enum: ["allow", "ask", "block"] }
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
};
