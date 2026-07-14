import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  configureAgentProxy,
  DEFAULT_LOCAL_PROXY_IMAGE,
  LOCAL_PROXY_URL,
} from "./proxy-manager.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "openleash-proxy-test-"));
process.env.HOME = home;

test("released desktop uses an immutable published proxy image", () => {
  assert.equal(
    DEFAULT_LOCAL_PROXY_IMAGE,
    "ghcr.io/open-leash/local-proxy:0.36.3@sha256:a82ab662a520cca6879b359f13f51e5e45e3a0679db4ebcb93c51e7d7cd382f0",
  );
  assert.doesNotMatch(DEFAULT_LOCAL_PROXY_IMAGE, /:latest$/);
});

test("Claude proxy configuration is reversible", () => {
  const file = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"env":{"EXISTING":"yes"},"theme":"dark"}\n');
  configureAgentProxy("claude-code", true);
  const configured = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(configured.env.ANTHROPIC_BASE_URL, `${LOCAL_PROXY_URL}/agent/claude-code`);
  assert.equal(configured.env.EXISTING, "yes");
  configureAgentProxy("claude-code", false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { env: { EXISTING: "yes" }, theme: "dark" });
});

test("Codex proxy configuration is idempotent and reversible", () => {
  const file = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = 'model = "gpt-5"\n\n[projects."/tmp"]\ntrust_level = "trusted"\n';
  fs.writeFileSync(file, original);
  configureAgentProxy("codex", true);
  configureAgentProxy("codex", true);
  const configured = fs.readFileSync(file, "utf8");
  assert.equal((configured.match(/Managed by OpenLeash/g) ?? []).length, 1);
  assert.match(configured, new RegExp(`base_url = "${LOCAL_PROXY_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/agent/codex/v1"`));
  assert.match(configured, /\[projects\."\/tmp"\]/);
  configureAgentProxy("codex", false);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("unsupported agents fail without changing files", () => {
  assert.throws(() => configureAgentProxy("cursor", true), /Cursor Settings/);
});

test("NanoClaw shares the reversible Claude-compatible adapter", () => {
  const file = path.join(home, ".nanoclaw", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"env":{"KEEP":"yes"}}\n');
  configureAgentProxy("nanoclaw", true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).env.ANTHROPIC_BASE_URL, `${LOCAL_PROXY_URL}/agent/nanoclaw`);
  configureAgentProxy("nanoclaw", false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { env: { KEEP: "yes" } });
});

test("OpenCode provider overrides preserve provider configuration and restore", () => {
  const file = path.join(home, ".config", "opencode", "opencode.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = { model: "anthropic/claude", provider: { anthropic: { options: { apiKey: "{env:ANTHROPIC_API_KEY}" }, models: { custom: {} } }, custom: { npm: "x" } } };
  fs.writeFileSync(file, `${JSON.stringify(original)}\n`);
  configureAgentProxy("opencode", true);
  const configured = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(configured.provider.anthropic.options.baseURL, `${LOCAL_PROXY_URL}/agent/opencode`);
  assert.equal(configured.provider.openai.options.baseURL, `${LOCAL_PROXY_URL}/agent/opencode/v1`);
  assert.equal(configured.provider.anthropic.models.custom instanceof Object, true);
  assert.equal(configured.provider.custom.npm, "x");
  configureAgentProxy("opencode", false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), original);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
