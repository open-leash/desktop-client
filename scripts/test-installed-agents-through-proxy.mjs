#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const base = 19520 + Math.floor(Math.random() * 100);
const [apiPort, upstreamPort, proxyPort] = [base, base + 1, base + 2];
const events = [];
const upstreamRequests = [];
const claudeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-claude-smoke-"));
const openCodeStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-opencode-smoke-"));
for (const directory of ["config", "cache", "data", "state"]) {
  fs.mkdirSync(path.join(openCodeStateDir, directory), { recursive: true });
}
const requestedAgents = new Set(
  (process.env.LEASH_TEST_AGENTS ?? "claude,codex,opencode")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const agentTimeoutMs = Number(process.env.LEASH_AGENT_TIMEOUT_MS ?? 30000);

const api = http.createServer(async (req, res) => {
  const body = JSON.parse((await read(req)).toString() || "{}");
  res.setHeader("content-type", "application/json");
  if (req.url?.includes("/v1/plugin-runtime/transform")) {
    return res.end(
      JSON.stringify({
        requestBody: body.requestBody,
        appliedPluginIds: [],
        runs: [],
        monitoringPaused: false,
      }),
    );
  }
  events.push(body);
  res.end(
    JSON.stringify({
      decision: "allow",
      decisionId: "agent-smoke",
      summary: "allowed",
      results: [],
      finalPrompt: body.request?.event?.prompt ?? "",
    }),
  );
});
const upstream = http.createServer(async (req, res) => {
  const body = JSON.parse((await read(req)).toString() || "{}");
  upstreamRequests.push({ url: req.url, body });
  if (req.url.includes("/api/hello")) {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ message: "hello" }));
  }
  if (req.url.includes("/messages")) return anthropicReply(res, body);
  if (req.url.includes("/responses")) return responsesReply(res, body);
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      id: "chatcmpl_smoke",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "PROXY_OK" },
          finish_reason: "stop",
        },
      ],
    }),
  );
});

await Promise.all([listen(api, apiPort), listen(upstream, upstreamPort)]);
const proxy = spawn(
  "cargo",
  ["run", "--quiet", "--manifest-path", "apps/local-proxy/Cargo.toml", "--"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENLEASH_PROXY_LISTEN: `127.0.0.1:${proxyPort}`,
      OPENLEASH_CLIENT_API: `http://127.0.0.1:${apiPort}`,
      OPENLEASH_TOKEN: "test",
      OPENLEASH_OPENAI_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
      OPENLEASH_ANTHROPIC_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const results = [];
try {
  await waitForHealth();
  if (requestedAgents.has("claude") && exists("claude"))
    results.push(
      await run(
        "claude",
        [
          "-p",
          "Use the Bash tool once, then reply exactly PROXY_OK",
          "--model",
          "claude-sonnet-4-6",
          "--bare",
          "--dangerously-skip-permissions",
          "--no-session-persistence",
        ],
        {
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxyPort}/agent/claude-code`,
          // Claude's documented gateway credential bypasses Console-key
          // validation and is sent only to the local mock upstream above.
          ANTHROPIC_AUTH_TOKEN: "leash-local-smoke-token",
          CLAUDE_CONFIG_DIR: claudeConfigDir,
          DISABLE_AUTOUPDATER: "1",
        },
      ),
    );
  if (requestedAgents.has("codex") && exists("codex"))
    results.push(
      await run(
        "codex",
        [
          "exec",
          "Run printf OPENLEASH_CODEX_TOOL_OK in the shell, then reply exactly PROXY_OK",
          "--ephemeral",
          "--skip-git-repo-check",
          "--ignore-user-config",
          "-c",
          'model_provider="openleash-smoke"',
          "-c",
          `model_providers.openleash-smoke={name="Leash smoke",base_url="http://127.0.0.1:${proxyPort}/agent/codex/v1",wire_api="responses",env_key="OPENAI_API_KEY"}`,
        ],
        { OPENAI_API_KEY: "test-key" },
      ),
    );
  if (requestedAgents.has("opencode") && exists("opencode"))
    results.push(
      await run(
        "opencode",
        [
          "run",
          "Reply exactly PROXY_OK",
          "--model",
          "anthropic/claude-sonnet-4-6",
        ],
        {
          ANTHROPIC_API_KEY: "test-key",
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            provider: {
              anthropic: {
                options: {
                  baseURL: `http://127.0.0.1:${proxyPort}/agent/opencode`,
                },
              },
            },
          }),
          OPENCODE_CONFIG_DIR: path.join(openCodeStateDir, "config"),
          XDG_CACHE_HOME: path.join(openCodeStateDir, "cache"),
          XDG_DATA_HOME: path.join(openCodeStateDir, "data"),
          XDG_STATE_HOME: path.join(openCodeStateDir, "state"),
        },
      ),
    );

  for (const result of results) {
    assert.ok(
      result.intercepted,
      `${result.agent} did not send a model request through Leash (exit ${result.exitCode}, normalized events ${events.length}, upstream requests ${upstreamRequests.length}). stdout: ${result.output} stderr: ${result.stderr}`,
    );
  }
  const launched = new Set(results.map((result) => result.agent));
  const responseObserved = await waitFor(
    () =>
      [...launched].every((agent) => {
        const kind = agent === "claude" ? "claude-code" : agent;
        return events.some(
          (event) =>
            event.request?.agent?.kind === kind &&
            event.request?.event?.raw?.response === true,
        );
      }),
    3000,
  ).then(() => true, () => false);
  assert.ok(
    responseObserved,
    `Response normalization missing. results=${JSON.stringify(results.map(({ agent, exitCode, output, stderr }) => ({ agent, exitCode, output, stderr })))} events=${JSON.stringify(events.map((event) => ({ agent: event.request?.agent?.kind, name: event.request?.event?.eventName, raw: event.request?.event?.raw })))} upstream=${JSON.stringify(upstreamRequests.map((request) => ({ url: request.url, body: request.body })))}`,
  );
  if (launched.has("claude"))
    assert.ok(
      events.some((event) => event.request?.agent?.kind === "claude-code"),
      "Claude event attribution missing",
    );
  if (launched.has("claude"))
    assert.ok(
      events.some(
        (event) =>
          event.request?.agent?.kind === "claude-code" &&
          event.request?.event?.eventName === "PostToolUse" &&
          JSON.stringify(event.request?.event?.tool?.output).includes(
            "OPENLEASH_TOOL_OK",
          ),
      ),
      "Claude's real Bash tool result was not normalized",
    );
  if (launched.has("codex"))
    assert.ok(
      events.some((event) => event.request?.agent?.kind === "codex"),
      "Codex event attribution missing",
    );
  if (launched.has("codex"))
    assert.ok(
      events.some(
        (event) =>
          event.request?.agent?.kind === "codex" &&
          event.request?.event?.eventName === "PreToolUse" &&
          event.request?.event?.tool?.name === "exec" &&
          JSON.stringify(event.request?.event?.tool?.input).includes(
            "OPENLEASH_CODEX_TOOL_OK",
          ),
      ),
      `Codex custom tool call was not normalized: ${JSON.stringify(events.filter((event) => event.request?.agent?.kind === "codex").map((event) => ({ name: event.request.event.eventName, tool: event.request.event.tool, response: event.request.event.raw?.response })))}`,
    );
  if (launched.has("opencode"))
    assert.ok(
      events.some((event) => event.request?.agent?.kind === "opencode"),
      "OpenCode event attribution missing",
    );
  if (launched.has("opencode"))
    assert.ok(
      events.some(
        (event) =>
          event.request?.agent?.kind === "opencode" &&
          event.request?.event?.eventName === "PostToolUse" &&
          JSON.stringify(event.request?.event?.tool?.output).includes(
            "OPENLEASH_TOOL_OK",
          ),
      ),
      `OpenCode's real bash tool result was not normalized: ${JSON.stringify(events.filter((event) => event.request?.agent?.kind === "opencode").map((event) => ({ name: event.request.event.eventName, tool: event.request.event.tool, response: event.request.event.raw?.response })))}`,
    );
  console.log(
    JSON.stringify(
      {
        ok: true,
        agents: results.map(({ agent, exitCode, output }) => ({
          agent,
          exitCode,
          output: output.trim().slice(-120),
        })),
        normalizedEvents: events.length,
        upstreamRequests: upstreamRequests.length,
      },
      null,
      2,
    ),
  );
} finally {
  proxy.kill("SIGTERM");
  api.closeAllConnections();
  upstream.closeAllConnections();
  api.close();
  upstream.close();
  fs.rmSync(claudeConfigDir, { recursive: true, force: true });
  fs.rmSync(openCodeStateDir, { recursive: true, force: true });
}

async function run(agent, args, extraEnv) {
  const before = upstreamRequests.length;
  const child = spawn(agent, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    stderr = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  let timer;
  const exitCode = await Promise.race([
    new Promise((resolve) => child.on("close", resolve)),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(124);
      }, agentTimeoutMs);
    }),
  ]);
  clearTimeout(timer);
  await waitFor(() => upstreamRequests.length > before, 3000).catch(() => {});
  return {
    agent,
    exitCode,
    output,
    stderr,
    intercepted: upstreamRequests.length > before,
  };
}
function anthropicReply(res, body) {
  const stream = body.stream;
  const hasToolResult = (body.messages ?? []).some((message) =>
    Array.isArray(message.content)
      ? message.content.some((block) => block.type === "tool_result")
      : false,
  );
  const shouldCallTool =
    Array.isArray(body.tools) && body.tools.length > 0 && !hasToolResult;
  if (shouldCallTool) {
    const requested =
      body.tools.find((tool) => /bash/i.test(tool.name)) ?? body.tools[0];
    const name = requested.name;
    const input = /bash/i.test(name)
      ? {
          command: "printf OPENLEASH_TOOL_OK",
          description: "Leash proxy smoke test",
        }
      : {};
    if (!stream) {
      res.setHeader("content-type", "application/json");
      return res.end(
        JSON.stringify({
          id: "msg_tool",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "tool_use", id: "tool_smoke", name, input }],
          stop_reason: "tool_use",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    }
    res.setHeader("content-type", "text/event-stream");
    const frames = [
      {
        type: "message_start",
        message: {
          id: "msg_tool",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool_smoke", name, input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(input),
        },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 1 },
      },
      { type: "message_stop" },
    ];
    for (const frame of frames)
      res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
    return res.end();
  }
  if (!stream) {
    res.setHeader("content-type", "application/json");
    return res.end(
      JSON.stringify({
        id: "msg_smoke",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: "PROXY_OK" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  }
  res.setHeader("content-type", "text/event-stream");
  const frames = [
    {
      type: "message_start",
      message: {
        id: "msg_smoke",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "PROXY_OK" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
  for (const frame of frames)
    res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
  res.end();
}
function responsesReply(res, body) {
  const stream = body.stream;
  const hasShellResult = (body.input ?? []).some(
    (item) => item.type === "custom_tool_call_output",
  );
  if (!hasShellResult) {
    const shellCall = {
      id: "ls_smoke",
      call_id: "call_smoke",
      type: "custom_tool_call",
      status: "completed",
      name: "exec",
      input:
        'const r = await tools.exec_command({cmd: "printf OPENLEASH_CODEX_TOOL_OK"}); text(r.output);',
    };
    const toolResponse = {
      id: "resp_tool",
      object: "response",
      status: "completed",
      model: body.model ?? "gpt-test",
      output: [shellCall],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    if (!stream) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(toolResponse));
    }
    res.setHeader("content-type", "text/event-stream");
    for (const frame of [
      {
        type: "response.created",
        response: { ...toolResponse, status: "in_progress", output: [] },
      },
      { type: "response.output_item.added", output_index: 0, item: shellCall },
      {
        type: "response.custom_tool_call_input.delta",
        output_index: 0,
        delta: shellCall.input,
      },
      {
        type: "response.custom_tool_call_input.done",
        output_index: 0,
        input: shellCall.input,
      },
      { type: "response.output_item.done", output_index: 0, item: shellCall },
      { type: "response.completed", response: toolResponse },
    ])
      res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  const response = {
    id: "resp_smoke",
    object: "response",
    status: "completed",
    model: "gpt-test",
    output: [
      {
        id: "msg_smoke",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "PROXY_OK", annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  if (!stream) {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify(response));
  }
  res.setHeader("content-type", "text/event-stream");
  for (const frame of [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...response.output[0], content: [] },
    },
    {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "PROXY_OK",
    },
    {
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text: "PROXY_OK",
    },
    {
      type: "response.content_part.done",
      output_index: 0,
      content_index: 0,
      part: response.output[0].content[0],
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: response.output[0],
    },
    { type: "response.completed", response },
  ])
    res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
function exists(command) {
  return (
    spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" })
      .status === 0
  );
}
function listen(server, port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}
function read(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function waitForHealth() {
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${proxyPort}/healthz`)).ok;
    } catch {
      return false;
    }
  }, 12000);
}
async function waitFor(predicate, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timeout");
}
