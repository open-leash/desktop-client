import assert from "node:assert/strict";
import test from "node:test";
import { containerRunArgs } from "./plugin-container-manager";
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
  assert.ok(!args.includes("127.0.0.1:9444:8080"));
  assert.ok(args.includes("no-new-privileges:true"));
  assert.ok(args.includes("ALL"));
  assert.ok(args.includes("none"));
  assert.equal(args.at(-1), "acme/compress:2.0.0@sha256:abc");
});
