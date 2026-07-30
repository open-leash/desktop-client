import assert from "node:assert/strict";
import test from "node:test";
import { hasManagedCodexProxy, openCodePluginSource } from "./agent-registry";
import { enableCodexHooksFeature } from "./codex-config";

const context = {
  apiUrl: "https://api.openleash.test",
  token: "test-token",
  clientVersion: "test-version",
};

test("Codex monitoring re-enables hooks after an earlier uninstall", () => {
  const config = [
    'model = "gpt-5.6-sol"',
    "",
    "[features]",
    "hooks = false",
    'other_feature = "preserved"',
    "",
    "[mcp_servers.docs]",
    'url = "https://example.test/mcp"',
    "",
  ].join("\n");

  const enabled = enableCodexHooksFeature(config);
  assert.match(enabled, /\[features\]\nhooks = true\n/);
  assert.doesNotMatch(enabled, /hooks = false/);
  assert.match(enabled, /other_feature = "preserved"/);
  assert.match(enabled, /\[mcp_servers\.docs\]/);
  assert.equal(enableCodexHooksFeature(enabled), enabled);
});

test("Codex monitoring adds the hooks feature when no features table exists", () => {
  const enabled = enableCodexHooksFeature('model = "gpt-5.6-sol"\n');
  assert.match(enabled, /\[features\]\nhooks = true\n$/);
});

test("Codex monitoring recognizes the OpenLeash-managed local proxy", () => {
  const configured = [
    "# Managed by OpenLeash local proxy",
    'model_provider = "openleash"',
    "",
    "[model_providers.openleash]",
    'name = "OpenLeash local proxy"',
    'base_url = "http://127.0.0.1:9320/agent/codex/v1"',
    'wire_api = "responses"',
  ].join("\n");
  assert.equal(hasManagedCodexProxy(configured), true);
  assert.equal(hasManagedCodexProxy(configured.replace("# Managed by OpenLeash local proxy\n", "")), false);
  assert.equal(hasManagedCodexProxy(configured.replace("/agent/codex/v1", "/v1")), false);
});

async function loadOpenCodePlugin() {
  const source = openCodePluginSource(context);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`;
  const nativeImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<unknown>;
  return (await nativeImport(moduleUrl)) as {
    OpenLeash: (input: Record<string, unknown>) => Promise<Record<string, any>>;
  };
}

test("OpenCode native questions are answered through the island response", async () => {
  const originalFetch = globalThis.fetch;
  const hookRequests: Array<Record<string, any>> = [];
  const replies: Array<Record<string, any>> = [];
  globalThis.fetch = async (_input, init) => {
    hookRequests.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        decision: "allow",
        response: { answers: { "Which deployment target?": "Staging" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const { OpenLeash } = await loadOpenCodePlugin();
    const hooks = await OpenLeash({
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: {
        question: {
          reply: async (input: Record<string, any>) => replies.push(input),
        },
      },
    });
    await hooks.event({
      event: {
        type: "question.asked",
        properties: {
          id: "question-1",
          sessionID: "session-1",
          questions: [
            {
              question: "Which deployment target?",
              header: "Target",
              options: [
                { label: "Production", description: "Deploy publicly" },
                { label: "Staging", description: "Deploy for testing" },
              ],
            },
          ],
        },
      },
    });
    assert.equal(hookRequests[0].tool_name, "AskUserQuestion");
    assert.equal(hookRequests[0].session_id, "session-1");
    assert.deepEqual(replies, [
      {
        requestID: "question-1",
        directory: "/tmp/project",
        answers: [["Staging"]],
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenCode uses its event stream for completion and its permission hook for policy", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    const body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        decision: body.tool_name === "filesystem" ? "block" : "allow",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const { OpenLeash } = await loadOpenCodePlugin();
    const hooks = await OpenLeash({
      directory: "/tmp/project",
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: {},
    });
    await hooks.event({
      event: { type: "session.idle", properties: { sessionID: "session-2" } },
    });
    const output = { status: "ask" };
    await hooks["permission.ask"](
      {
        permission: "filesystem",
        patterns: ["/tmp/project/**"],
        metadata: {},
        sessionID: "session-2",
      },
      output,
    );
    assert.match(urls[0], /\/v1\/hooks\/opencode\/Stop/);
    assert.match(urls[1], /\/v1\/hooks\/opencode\/PreToolUse/);
    assert.equal(output.status, "deny");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
