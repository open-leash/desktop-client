import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRequest, PluginCatalogItem } from "@openleash/shared";
import { createPluginCapabilities } from "./capabilities.js";
import { isIslandContributionEnabled, normalizeIslandContribution } from "./island-contributions.js";

const request: EvaluationRequest = {
  computer: { hostname: "dev-mac", platform: "darwin" },
  agent: { kind: "codex", displayName: "OpenAI Codex" },
  event: {
    eventName: "PreToolUse",
    agentKind: "codex",
    sessionId: "session-123",
    projectPath: "/code/openleash",
    tool: { name: "Bash", input: { command: "npm test" } },
    occurredAt: "2026-07-20T10:00:00.000Z",
  },
};

test("plugin island API infers session, agent, project, plugin, and expiry", async () => {
  const capabilities = createPluginCapabilities({
    pluginId: "community.test-progress",
    request,
    runtimeId: "agent-runtime-123",
    permissions: ["island:publish"],
  });
  const result = await capabilities.island.reportActivity({
    key: "tests",
    title: "Tests running",
    detail: "Unit test suite",
    status: "running",
    progress: { current: 18, total: 24, label: "tests" },
  });

  assert.equal(result.contribution.pluginId, "community.test-progress");
  assert.equal(result.contribution.sessionId, "session-123");
  assert.equal(result.contribution.agentKind, "codex");
  assert.equal(result.contribution.agentId, "agent-runtime-123");
  assert.equal(result.contribution.projectPath, "/code/openleash");
  assert.deepEqual(result.contribution.progress, { current: 18, total: 24, label: "tests" });
  assert.ok(Date.parse(result.contribution.expiresAt) > Date.parse(result.contribution.updatedAt));
});

test("island visibility follows organization and user agent profile precedence", () => {
  const contribution = normalizeIslandContribution(
    { pluginId: "community.scoped", request, agentId: "agent-runtime-123" },
    { kind: "annotation", key: "scope", label: "Scoped" },
  );
  const plugin = {
    id: "community.scoped",
    settings: {
      enabled: true,
      config: {},
      inheritedProfiles: [{
        id: "org-codex",
        name: "Org Codex",
        agentKinds: ["codex"],
        enabled: true,
        config: {},
      }],
      profiles: [{
        id: "this-agent-off",
        name: "This agent off",
        agentKinds: ["codex"],
        agentIds: ["agent-runtime-123"],
        enabled: false,
        config: {},
      }],
    },
    organizationPolicy: { mandatory: false, defaultEnabled: true, userInstallAllowed: true, configLocked: false },
  } as PluginCatalogItem;
  assert.equal(isIslandContributionEnabled(contribution, [plugin]), false);
  assert.equal(isIslandContributionEnabled(
    { ...contribution, agentId: "agent-runtime-456" },
    [plugin],
  ), true);
  assert.equal(isIslandContributionEnabled(contribution, [{
    ...plugin,
    organizationPolicy: { ...plugin.organizationPolicy!, configLocked: true },
  }]), true);
});

test("island publishing requires an explicit manifest permission", async () => {
  const capabilities = createPluginCapabilities({ pluginId: "community.no-ui", request });
  await assert.rejects(
    capabilities.island.annotateSession({ key: "risk", label: "Risk" }),
    /requires island:publish/,
  );
});

test("host validation bounds content and only accepts typed safe actions", () => {
  const contribution = normalizeIslandContribution(
    { pluginId: "community.safe", request },
    {
      kind: "annotation",
      key: "risk",
      label: "R".repeat(200),
      detail: "D".repeat(600),
      ttlSeconds: 99_999,
      action: { id: "open", label: "Open session", type: "open-session" },
    },
    Date.parse("2026-07-20T10:00:00.000Z"),
  );
  assert.equal(contribution.label?.length, 80);
  assert.equal(contribution.detail?.length, 300);
  assert.equal(Date.parse(contribution.expiresAt) - Date.parse(contribution.updatedAt), 3_600_000);
  assert.deepEqual(contribution.action, { id: "open", label: "Open session", type: "open-session" });
  assert.throws(
    () => normalizeIslandContribution(
      { pluginId: "community.unsafe", request },
      { kind: "annotation", key: "bad", label: "Bad", action: { id: "run", label: "Run", type: "shell" } } as never,
    ),
    /unsupported island action/,
  );
});

test("ambient status supports related sessions without inheriting one session", () => {
  const contribution = normalizeIslandContribution(
    { pluginId: "community.workflow", request },
    {
      kind: "status",
      key: "deploy",
      title: "Deployment running",
      tone: "info",
      relatedSessionIds: ["session-123", "session-456", "session-123"],
    },
  );
  assert.equal(contribution.sessionId, undefined);
  assert.deepEqual(contribution.relatedSessionIds, ["session-123", "session-456"]);
});
