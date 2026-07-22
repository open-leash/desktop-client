import assert from "node:assert/strict";
import test from "node:test";
import { containerRunArgs, isDesiredEdgeContainer, transformViaLocalPluginContainers } from "./plugin-container-manager";
import type { PluginCatalogItem } from "./plugin-catalog";

test("container plan is loopback-only, constrained, and digest-pinned when supplied", () => {
  const plugin = {
    id: "acme.compress",
    name: "compress",
    description: "test",
    version: "2.0.0",
    publisher: "acme",
    runtime: "container",
    execution: {
      type: "container",
      placement: "edge",
      protocol: "openleash-container-plugin.v1",
      image: "acme/compress:2.0.0",
      digest: "sha256:abc",
      edgePort: 9444,
      storage: { persistent: true, volumeName: "acme-data" },
    },
    entrypoint: "container",
    events: ["provider.request.beforeSend"],
    permissions: ["provider-request:read"],
    effects: ["transform"],
    settings: { enabled: true, config: {}, installedVersion: "2.0.0" },
  } as PluginCatalogItem;
  const args = containerRunArgs(plugin);
  assert.ok(!args.some((arg) => arg.includes("9444")));
  assert.ok(args.includes("no-new-privileges:true"));
  assert.ok(args.includes("ALL"));
  assert.ok(args.includes("openleash-plugin-runtime"));
  assert.equal(args.at(-1), "acme/compress:2.0.0@sha256:abc");
});

test("an organization agent profile starts one shared plugin container even when base enablement is off", () => {
  const plugin = {
    id: "acme.agent-policy",
    name: "agent-policy",
    description: "test",
    version: "1.0.0",
    publisher: "acme",
    runtime: "container",
    execution: {
      type: "container",
      placement: "edge",
      protocol: "openleash-container-plugin.v1",
      image: "acme/agent-policy:1.0.0",
    },
    entrypoint: "container",
    events: ["provider.request.beforeSend"],
    permissions: ["provider-request:read"],
    effects: ["observe"],
    settings: {
      enabled: false,
      config: {},
      inheritedProfiles: [{
        id: "org-codex",
        name: "Organization Codex policy",
        agentKinds: ["codex"],
        enabled: true,
        config: {},
      }],
    },
  } as PluginCatalogItem;
  assert.equal(isDesiredEdgeContainer(plugin), true);
});

test("desktop transform invokes only plugins subscribed to provider requests", async () => {
  const plugin = {
    id: "acme.tool-policy",
    name: "tool-policy",
    description: "test",
    version: "1.0.0",
    publisher: "acme",
    runtime: "container",
    execution: {
      type: "container",
      placement: "either",
      protocol: "openleash-container-plugin.v1",
      image: "acme/tool-policy:1.0.0",
      edgePort: 9445,
    },
    entrypoint: "container",
    events: ["tool.beforeUse"],
    permissions: ["tool:read"],
    effects: ["observe"],
    settings: { enabled: true, config: {} },
  } as PluginCatalogItem;
  const result = await transformViaLocalPluginContainers({
    plugins: [plugin],
    provider: "anthropic",
    agentKind: "claude",
    sessionId: "session",
    organizationId: "org",
    userId: "user",
    requestBody: { messages: [] },
  });
  assert.deepEqual(result.appliedPluginIds, []);
  assert.deepEqual(result.runs, []);
});
