#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import process from "node:process";

const clientPort = Number(process.env.OPENLEASH_SMOKE_CLIENT_PORT ?? 4618);
const dashboardPort = Number(
  process.env.OPENLEASH_SMOKE_DASHBOARD_PORT ?? 4619,
);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://openleash:openleash@localhost:9543/openleash";
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
const devToken = process.env.OPENLEASH_DEV_TOKEN ?? "local-test-fixture";
const releaseToken =
  process.env.OPENLEASH_RELEASE_ADMIN_TOKEN ?? "dev-release-admin-token";
const smokeRunId = `smoke-${Date.now()}-${process.pid}`;
const composeProject = process.env.OPENLEASH_SMOKE_COMPOSE_PROJECT
  ?? `openleash-smoke-${process.pid}`;
let composeStarted = false;
const children = new Set();
const servers = new Set();

try {
  await run("docker", ["compose", "--project-name", composeProject, "up", "-d", "--wait", "postgres"]);
  composeStarted = true;
  await run("npm", ["run", "db:migrate", "--", "--apply"], {
    DATABASE_URL: databaseUrl,
    OPENLEASH_DEV_TOKEN: devToken,
    OPENLEASH_DEV_ORG_SLUG: "openleash",
    OPENLEASH_DEV_ORG_NAME: "OpenLeash Smoke",
  });
  await run("npm", ["run", "build", "-w", "@openleash/client-api"]);

  const clientApi = startApi("client-api", clientPort, "client");
  const dashboardApi = startApi("dashboard-api", dashboardPort, "dashboard");
  await waitForHealth(clientPort, "client");
  await waitForHealth(dashboardPort, "dashboard");

  const clientBase = `http://127.0.0.1:${clientPort}`;
  const dashboardBase = `http://127.0.0.1:${dashboardPort}`;
  const proxyFixture = await startProxyFixture(clientBase, devToken);

  const dashboardAuth = await json(
    "dashboard smoke auth",
    `${clientBase}/v1/mobile/auth/exchange`,
    {
      method: "POST",
      body: {
        providerType: "google",
        authorizationCode: "dev-auth",
        redirectUri: "http://localhost:9317/v1/auth/google/callback",
        audience: "organization",
        organizationSlug: "openleash",
      },
    },
  );
  const dashboardToken = dashboardAuth.sessionToken;
  assert(dashboardToken, "dashboard smoke auth should return a session token");

  if (process.env.OPENLEASH_SMOKE_REAL_PLUGIN_AGENTS === "1") {
    for (const pluginId of [
      "openleash.prompt-compression",
      "openleash.dlp",
      "openleash.sensitive-access",
    ]) {
      await json(
        `install ${pluginId} for real-agent smoke`,
        `${clientBase}/v1/plugins/${encodeURIComponent(pluginId)}/install`,
        { method: "POST", token: devToken },
      );
    }
    await testRealPluginAgents({
      clientBase,
      dashboardBase,
      dashboardToken,
      proxyFixture,
    });
  }

  await expectStatus(
    "client rejects dashboard routes",
    `${clientBase}/admin/overview`,
    { method: "GET" },
    404,
  );
  await expectStatus(
    "dashboard rejects client routes",
    `${dashboardBase}/v1/evaluate`,
    { method: "POST", body: "{}" },
    404,
  );

  const overview = await json(
    "dashboard overview",
    `${dashboardBase}/admin/overview`,
    { token: dashboardToken },
  );
  assert(overview?.metrics, "dashboard overview should include metrics");

  const plugins = await json(
    "dashboard plugins",
    `${dashboardBase}/admin/plugins`,
    { token: dashboardToken },
  );
  assert(
    Array.isArray(plugins.plugins),
    "dashboard plugin catalog should return plugins",
  );
  assert(
    plugins.plugins.some((plugin) => plugin.id === "openleash.rules-enforcer"),
    "plugin catalog should include rules enforcer",
  );
  const pluginSettings = await json(
    "dashboard plugin settings write",
    `${dashboardBase}/admin/plugins/${encodeURIComponent("openleash.mcp-scanner")}/settings`,
    {
      method: "POST",
      token: dashboardToken,
      body: {
        enabled: false,
        config: { enabled: false, redactSecrets: true },
        orderingPriority: 400,
      },
    },
  );
  assert(
    pluginSettings.settings?.enabled === false,
    "plugin settings write should persist enabled=false",
  );
  const pluginSettingsRestore = await json(
    "dashboard plugin settings restore",
    `${dashboardBase}/admin/plugins/${encodeURIComponent("openleash.mcp-scanner")}/settings`,
    {
      method: "POST",
      token: dashboardToken,
      body: {
        enabled: true,
        config: { enabled: true, redactSecrets: true },
        profiles: [{
          id: "codex-redaction",
          name: "Codex redaction override",
          agentKinds: ["codex"],
          config: { redactSecrets: false },
          priority: 100,
        }],
        orderingPriority: 400,
      },
    },
  );
  assert(
    pluginSettingsRestore.settings?.enabled === true,
    "plugin settings restore should persist enabled=true",
  );
  assert(
    pluginSettingsRestore.settings?.profiles?.[0]?.id === "codex-redaction",
    "plugin settings should round-trip agent-scoped profiles",
  );
  const promptTransformSettings = await json(
    "dashboard prompt-transform plugin settings",
    `${dashboardBase}/admin/plugins/${encodeURIComponent("openleash.dlp")}/settings`,
    {
      method: "POST",
      token: dashboardToken,
      body: {
        enabled: true,
        config: {
          enabled: true,
          action: "mask",
          categories: ["pii", "phi", "tokens", "keys", "credentials"],
        },
      },
    },
  );
  assert(
    promptTransformSettings.settings?.enabled === true,
    "smoke prompt-transform plugin should be enabled deterministically",
  );
  // This smoke process intentionally does not start container plugin runtimes.
  // Restore DLP to disabled before exercising the provider pipeline; a required
  // container plugin that is unavailable must fail closed, which is covered by
  // the container-plugin end-to-end gate instead of this API-only smoke test.
  await json(
    "dashboard prompt-transform plugin settings restore",
    `${dashboardBase}/admin/plugins/${encodeURIComponent("openleash.dlp")}/settings`,
    {
      method: "POST",
      token: dashboardToken,
      body: {
        enabled: false,
        config: {
          enabled: false,
          action: "mask",
          categories: ["pii", "phi", "tokens", "keys", "credentials"],
        },
      },
    },
  );
  const unavailableVersion = await json(
    "plugin missing release version write",
    `${dashboardBase}/admin/plugins/${encodeURIComponent("openleash.mcp-scanner")}/settings`,
    { method: "POST", token: dashboardToken, body: { enabled: true, config: {}, installedVersion: "0.0.0" } },
  );
  assert(unavailableVersion.settings?.installedVersion === "0.0.0", "test version should persist");
  const unavailableCatalog = await json("plugin missing release catalog", `${dashboardBase}/admin/plugins`, { token: dashboardToken });
  const unavailablePlugin = unavailableCatalog.plugins.find((plugin) => plugin.id === "openleash.mcp-scanner");
  assert(unavailablePlugin?.settings?.runtimeAvailable === false, "an unavailable installed version must fail closed instead of running current code under an old label");
  await json(
    "plugin current release version restore",
    `${dashboardBase}/admin/plugins/${encodeURIComponent("openleash.mcp-scanner")}/settings`,
    { method: "POST", token: dashboardToken, body: { enabled: true, config: { enabled: true, redactSecrets: true }, profiles: pluginSettingsRestore.settings.profiles, installedVersion: unavailablePlugin.settings.availableVersion } },
  );

  const update = await json(
    "client update check",
    `${clientBase}/api/updates/check`,
    {
      method: "POST",
      body: {
        app: "openleash-personal",
        version: "0.0.0",
        platform: "darwin",
        arch: "arm64",
        channel: "stable",
        installMode: "cloud",
        updateSource: "smoke",
      },
    },
  );
  assert(
    typeof update.updateAvailable === "boolean",
    "update check should return updateAvailable",
  );

  const evaluation = await json(
    "client evaluation",
    `${clientBase}/v1/evaluate`,
    {
      method: "POST",
      token: devToken,
      body: evaluationPayload(),
    },
  );
  assert(
    ["allow", "deny", "ask"].includes(evaluation.decision),
    "evaluation should return a valid decision",
  );
  assert(
    evaluation.decisionId,
    "evaluation should persist and return decisionId",
  );

  const proxyMarker = `proxy-pipeline-${Date.now()}`;
  const proxiedResponse = await fetch(
    `${proxyFixture.proxyBase}/agent/claude-code/v1/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "smoke" },
      body: JSON.stringify({
        model: "claude-smoke",
        messages: [{ role: "user", content: proxyMarker }],
      }),
    },
  );
  const proxiedBody = await proxiedResponse.text();
  assert(
    proxiedResponse.ok,
    `full proxy request should succeed, got ${proxiedResponse.status}: ${proxiedBody}`,
  );
  assert(
    proxiedBody.includes("PIPELINE_OK"),
    "provider response should traverse the proxy unchanged",
  );
  assert(
    proxyFixture.upstreamRequests.some(
      (request) => request.messages?.[0]?.content === proxyMarker,
    ),
    "provider upstream should receive the evaluated prompt",
  );

  const proxyLogs = await json(
    "proxy event in logs",
    `${dashboardBase}/admin/logs?q=${encodeURIComponent(proxyMarker)}`,
    { token: dashboardToken },
  );
  assert(
    proxyLogs.logs.length === 1,
    `proxy event should appear exactly once in the shared logs pipeline (received ${proxyLogs.logs.length})`,
  );
  assert(
    Array.isArray(proxyLogs.logs[0].payload?.raw?.containerPluginRuns),
    "proxy event should persist plugin execution metadata",
  );

  await json(
    "duplicate Claude API hook",
    `${clientBase}/v1/hooks/claude/UserPromptSubmit?hostname=smoke-mac&platform=darwin`,
    {
      method: "POST",
      token: devToken,
      body: { session_id: `${smokeRunId}-hook-copy`, prompt: proxyMarker },
    },
  );
  const deduplicatedLogs = await json(
    "deduplicated shared logs",
    `${dashboardBase}/admin/logs?q=${encodeURIComponent(proxyMarker)}`,
    { token: dashboardToken },
  );
  assert(
    deduplicatedLogs.logs.length === 1,
    "equivalent API-hook and proxy events must deduplicate before plugins/log persistence",
  );

  const concurrentMarker = `CONCURRENT_IDEMPOTENCY_${Date.now()}`;
  const concurrentRequest = {
    ...evaluationPayload(),
    event: {
      ...evaluationPayload().event,
      eventName: "UserPromptSubmit",
      sessionId: `${smokeRunId}-concurrent-idempotency`,
      prompt: concurrentMarker,
      tool: undefined,
    },
  };
  const concurrentResponses = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(`${clientBase}/v1/agent-events`, {
        method: "POST",
        token: devToken,
        body: {
          source: "local_proxy",
          provider: "anthropic",
          idempotencyKey: `smoke-${concurrentMarker}`,
          request: concurrentRequest,
        },
      }),
    ),
  );
  assert(
    concurrentResponses.every((response) => response.ok),
    `concurrent duplicate events must all succeed, got ${concurrentResponses.map((response) => response.status).join(", ")}`,
  );

  const hook = await json(
    "claude hook",
    `${clientBase}/v1/hooks/claude/PreToolUse?hostname=smoke-mac&platform=darwin`,
    {
      method: "POST",
      token: devToken,
      body: {
        session_id: `${smokeRunId}-hook`,
        cwd: `/tmp/openleash-smoke/${smokeRunId}`,
        tool_name: "Read",
        tool_input: { file_path: ".env" },
      },
    },
  );
  assert(
    hook?.hookSpecificOutput?.hookEventName === "PreToolUse",
    "hook should return Claude hook output",
  );

  const mobile = await json(
    "mobile bootstrap",
    `${clientBase}/v1/mobile/bootstrap`,
  );
  assert(
    Array.isArray(mobile.providers),
    "mobile bootstrap should return providers",
  );

  await expectStatus(
    "dashboard blocks direct organization creation",
    `${dashboardBase}/organizations`,
    {
      method: "POST",
      token: dashboardToken,
      body: { name: "Smoke Org", slug: "smoke-org", deploymentMode: "private" },
    },
    404,
  );
  await expectStatus(
    "dashboard rejects cross-organization reads",
    `${dashboardBase}/admin/logs?organizationSlug=smoke-org`,
    { method: "GET", token: dashboardToken },
    403,
  );

  const ssoProviders = await json(
    "organization SSO providers",
    `${dashboardBase}/organizations/openleash/sso-providers`,
    { token: dashboardToken },
  );
  assert(
    Array.isArray(ssoProviders.providers),
    "SSO provider discovery should return providers array",
  );

  const releaseUnauthorized = await fetch(`${clientBase}/api/admin/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(
    releaseUnauthorized.status === 401,
    "release publish should require admin token",
  );

  const releaseAuthorized = await fetch(`${clientBase}/api/admin/releases`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${releaseToken}`,
    },
    body: JSON.stringify({
      app: "openleash-personal",
      version: "0.0.1-smoke",
      channel: "smoke",
      platform: "darwin",
      arch: "arm64",
      dmgUrl: "https://downloads.example.invalid/OpenLeash-smoke.dmg",
      sha256: "smoke-sha256",
    }),
  });
  assert(
    releaseAuthorized.ok,
    `release publish should accept admin token, got ${releaseAuthorized.status}`,
  );

  console.log("OpenLeash product smoke ok");
  clientApi.kill("SIGTERM");
  dashboardApi.kill("SIGTERM");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGTERM");
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  if (composeStarted) {
    await run("docker", ["compose", "--project-name", composeProject, "down", "--remove-orphans"])
      .catch((error) => console.error(`Could not stop ${composeProject}: ${error.message}`));
  }
}

async function startProxyFixture(clientBase, token) {
  const upstreamPort = clientPort + 2;
  const proxyPort = clientPort + 3;
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const body = JSON.parse((await readRequest(req)).toString() || "{}");
    upstreamRequests.push(body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "msg_pipeline",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: "PIPELINE_OK" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
  servers.add(upstream);
  await new Promise((resolve) =>
    upstream.listen(upstreamPort, "127.0.0.1", resolve),
  );
  const proxy = spawn(
    "cargo",
    ["run", "--quiet", "--manifest-path", "apps/local-proxy/Cargo.toml", "--"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENLEASH_PROXY_LISTEN: `127.0.0.1:${proxyPort}`,
        OPENLEASH_CLIENT_API: clientBase,
        OPENLEASH_TOKEN: token,
        OPENLEASH_ANTHROPIC_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
        OPENLEASH_OPENAI_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let proxyOutput = "";
  proxy.stdout.on("data", (chunk) => {
    proxyOutput += chunk;
  });
  proxy.stderr.on("data", (chunk) => {
    proxyOutput += chunk;
  });
  children.add(proxy);
  proxy.on("exit", () => children.delete(proxy));
  const proxyBase = `http://127.0.0.1:${proxyPort}`;
  // A clean GitHub runner has to compile the Rust proxy before it can listen.
  // Keep the readiness timeout distinct from API startup so a cold Cargo cache
  // does not make the product smoke test flaky.
  const deadline = Date.now() + Number(
    process.env.OPENLEASH_SMOKE_PROXY_TIMEOUT_MS ?? 120000,
  );
  while (Date.now() < deadline) {
    if (proxy.exitCode !== null) {
      throw new Error(
        `full-pipeline proxy fixture exited ${proxy.exitCode}: ${proxyOutput.slice(-2000)}`,
      );
    }
    try {
      if ((await fetch(`${proxyBase}/healthz`)).ok)
        return { proxyBase, upstreamRequests };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for full-pipeline proxy fixture: ${proxyOutput.slice(-2000)}`,
  );
}

async function testRealPluginAgents({
  clientBase,
  dashboardBase,
  dashboardToken,
  proxyFixture,
}) {
  const proxyPort = new URL(proxyFixture.proxyBase).port;
  const marker = `real-plugin-${Date.now()}`;
  const configureTransforms = async (config) => {
    const result = await json(
      "configure real plugin transforms",
      `${clientBase}/v1/client/prompt-transforms`,
      {
        method: "POST",
        token: devToken,
        body: { config },
      },
    );
    if (config.compression.enabled) {
      await json(
        "configure token-saver container",
        `${clientBase}/v1/plugins/${encodeURIComponent("openleash.prompt-compression")}/settings`,
        {
          method: "POST",
          token: devToken,
          body: {
            enabled: true,
            config: {
              ...config.compression,
              minimumChars: 256,
              protectRecent: 0,
              ccrEnabled: true,
              ccrTtlSeconds: 3600,
            },
          },
        },
      );
    }
    return result;
  };
  const disabledCompression = {
    enabled: false,
    level: "maximum",
    conciseResponse: false,
    model: "gpt-4.1-nano",
  };
  const disabledDlp = {
    enabled: false,
    action: "mask",
    categories: ["pii", "phi", "tokens", "keys", "credentials"],
    model: "gpt-4.1-nano",
  };

  if (commandExists("claude")) {
    await configureTransforms({
      compression: disabledCompression,
      dlp: { ...disabledDlp, enabled: true, action: "block" },
    });
    const before = proxyFixture.upstreamRequests.length;
    await runAgent(
      "claude",
      [
        "-p",
        `Forward ${marker}@example.com exactly`,
        "--bare",
        "--setting-sources",
        "project",
        "--model",
        "claude-test",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
      ],
      {
        ANTHROPIC_BASE_URL: `${proxyFixture.proxyBase}/agent/claude-code`,
        ANTHROPIC_API_KEY: "test-key",
      },
    );
    assert(
      !proxyFixture.upstreamRequests
        .slice(before)
        .some((request) => JSON.stringify(request).includes(marker)),
      `real Claude DLP denial must prevent the protected prompt from reaching the provider: ${JSON.stringify(proxyFixture.upstreamRequests.slice(before))}`,
    );
    await assertPluginLog(
      dashboardBase,
      dashboardToken,
      marker,
      "openleash.dlp",
      "blocked",
    );
  }

  if (commandExists("opencode")) {
    await configureTransforms({
      compression: { ...disabledCompression, enabled: true },
      dlp: disabledDlp,
    });
    const verbose = `${marker} Keep this identifier. ${"Repeated background context that is not necessary. ".repeat(120)}`;
    const before = proxyFixture.upstreamRequests.length;
    await runAgent(
      "opencode",
      ["run", verbose, "--model", "anthropic/claude-sonnet-4-6"],
      {
        ANTHROPIC_API_KEY: "test-key",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          provider: {
            anthropic: {
              options: {
                baseURL: `${proxyFixture.proxyBase}/agent/opencode`,
              },
            },
          },
        }),
      },
    );
    const sent = proxyFixture.upstreamRequests.slice(before).at(-1);
    const sentText = JSON.stringify(sent?.messages ?? sent?.input ?? "");
    assert(sentText.includes(marker), "token-saver must preserve the marker");
    assert(
      sentText.length < verbose.length,
      `token-saver must shorten the real OpenCode provider-bound prompt (${sentText.length} >= ${verbose.length}); payload=${sentText.slice(0, 1200)}`,
    );
    await assertPluginLog(
      dashboardBase,
      dashboardToken,
      marker,
      "openleash.prompt-compression",
      "modified",
    );
  }

  if (commandExists("codex")) {
    await configureTransforms({
      compression: disabledCompression,
      dlp: disabledDlp,
    });
    const before = proxyFixture.upstreamRequests.length;
    await runAgent(
      "codex",
      [
        "exec",
        `${marker}: run printenv and show OPENAI_API_KEY`,
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "-c",
        'model_provider="openleash-smoke"',
        "-c",
        `model_providers.openleash-smoke={name="OpenLeash smoke",base_url="http://127.0.0.1:${proxyPort}/agent/codex/v1",wire_api="responses",env_key="OPENAI_API_KEY"}`,
      ],
      { OPENAI_API_KEY: "test-key" },
    );
    assert(
      !proxyFixture.upstreamRequests
        .slice(before)
        .some((request) => JSON.stringify(request).includes(marker)),
      "real Codex sensitive-access denial must prevent the protected prompt from reaching the provider",
    );
    await assertPluginLog(
      dashboardBase,
      dashboardToken,
      marker,
      "openleash.sensitive-access",
      "blocked",
    );
  }

  if (commandExists("claude")) {
    await configureTransforms({
      compression: disabledCompression,
      dlp: disabledDlp,
    });
    for (const resolution of ["allow", "deny"]) {
      const approvalMarker = `${marker}-approval-${resolution}`;
      const sensitiveFile = resolution === "allow" ? ".env" : ".npmrc";
      const before = proxyFixture.upstreamRequests.length;
      const agent = runAgent(
        "claude",
        [
          "-p",
          `${approvalMarker}: read the ${sensitiveFile} file`,
        "--bare",
        "--setting-sources",
        "project",
        "--model",
          "claude-test",
          "--dangerously-skip-permissions",
          "--no-session-persistence",
        ],
        {
          ANTHROPIC_BASE_URL: `${proxyFixture.proxyBase}/agent/claude-code`,
          ANTHROPIC_API_KEY: "test-key",
        },
      );
      const decisionId = await waitForPendingDecision(approvalMarker);
      await json(
        `resolve real Claude approval ${resolution}`,
        `${clientBase}/admin/decisions/${decisionId}/resolve`,
        {
          method: "POST",
          token: devToken,
          body: { resolution, resolvedBy: "real-plugin-smoke" },
        },
      );
      await agent;
      const delivered = proxyFixture.upstreamRequests
        .slice(before)
        .some((request) => JSON.stringify(request).includes(approvalMarker));
      assert(
        resolution === "allow" ? delivered : !delivered,
        `Claude approval ${resolution} produced the wrong provider-delivery result`,
      );
    }
  }

  await configureTransforms({
    compression: disabledCompression,
    dlp: disabledDlp,
  });
}

async function waitForPendingDecision(marker) {
  const escaped = marker.replaceAll("'", "''");
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const query = `select e.id from evaluations e join conversation_events ce on ce.id=e.conversation_event_id where e.decision='ask' and e.resolution is null and ce.prompt like '%${escaped}%' order by e.created_at desc limit 1`;
    const result = spawnSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "openleash",
        "-d",
        databaseName,
        "-Atc",
        query,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const id = result.stdout.trim();
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`approval was not created for ${marker}`);
}

async function assertPluginLog(base, token, marker, pluginId, status) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const payload = await json(
      "real plugin log",
      `${base}/admin/logs?q=${encodeURIComponent(marker)}`,
      { token },
    );
    const runs = payload.logs.flatMap(
      (entry) => entry.payload?.openleashPluginRuns ?? [],
    );
    if (runs.some((run) => run.pluginId === pluginId && run.status === status))
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${pluginId} did not persist a ${status} run for ${marker}`);
}

function commandExists(command) {
  return (
    spawnSync("sh", ["-c", `command -v ${command}`], {
      stdio: "ignore",
    }).status === 0
  );
}

async function runAgent(command, args, extraEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await Promise.race([
    new Promise((resolve) => child.on("close", resolve)),
    new Promise((resolve) =>
      setTimeout(() => {
        child.kill("SIGTERM");
        resolve(124);
      }, 60000),
    ),
  ]);
  assert(exitCode !== 124, `${command} timed out: ${stderr}`);
  return { exitCode, stderr };
}

function readRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function startApi(name, port, surface) {
  const child = spawn("node", ["apps/client-api/dist/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      OPENLEASH_DEV_TOKEN: devToken,
      OPENLEASH_DEV_ORG_SLUG: "openleash",
      OPENLEASH_DEV_ORG_NAME: "OpenLeash Smoke",
      OPENLEASH_RELEASE_ADMIN_TOKEN: releaseToken,
      OPENLEASH_API_SURFACE: surface,
      OPENLEASH_API_PORT: String(port),
      OPENLEASH_DEPLOYMENT_MODE: surface === "dashboard" ? "private" : "cloud",
      OPENLEASH_HOOK_APPROVAL_TIMEOUT_MS: "5000",
      OPENLEASH_HOOK_APPROVAL_POLL_MS: "100",
      OPENLEASH_LOCAL_PROXY_AUTHORITATIVE: "1",
      OPENLEASH_MOBILE_DEV_AUTH: "1",
      OPENLEASH_MOBILE_DEV_EMAIL: "max.brin@openleash.local",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.stdout.on("data", (chunk) =>
    writePrefixed(name, chunk, process.stdout),
  );
  child.stderr.on("data", (chunk) =>
    writePrefixed(name, chunk, process.stderr),
  );
  child.on("exit", () => children.delete(child));
  return child;
}

async function waitForHealth(port, expectedSurface) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const payload = await response.json();
      if (response.ok && payload.surface === expectedSurface) return;
    } catch {
      // Keep waiting while the server boots.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expectedSurface} API on ${port}`);
}

async function expectStatus(label, url, init, status) {
  const response = await request(url, init);
  assert(
    response.status === status,
    `${label}: expected ${status}, got ${response.status}`,
  );
}

async function json(label, url, init = {}) {
  const response = await request(url, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label}: response was not JSON: ${text.slice(0, 200)}`);
  }
  assert(
    response.ok,
    `${label}: expected 2xx, got ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`,
  );
  return payload;
}

async function request(url, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  let body = init.body;
  if (body && typeof body !== "string") {
    headers["content-type"] ??= "application/json";
    body = JSON.stringify(body);
  }
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return fetch(url, { ...init, headers, body });
}

function evaluationPayload() {
  return {
    computer: { hostname: "smoke-mac", platform: "darwin", osRelease: "test" },
    agent: { kind: "claude-code", displayName: "Claude Code" },
    event: {
      eventName: "PreToolUse",
      agentKind: "claude-code",
      sessionId: `${smokeRunId}-evaluate`,
      projectPath: "/tmp/openleash-smoke",
      tool: { name: "Read", input: { file_path: ".env" } },
      occurredAt: new Date().toISOString(),
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
    child.on("error", reject);
  });
}

function writePrefixed(name, chunk, stream) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line) stream.write(`[${name}] ${line}\n`);
  }
}
