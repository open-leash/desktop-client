import crypto from "node:crypto";
import http from "node:http";

const protocol = "openleash-container-plugin.v1";
const pluginId = requiredEnv("OPENLEASH_PLUGIN_ID");
const pluginModule = await import("./plugin/index.js");
const port = Number(process.env.PORT || 8080);

class CapabilityRequired extends Error {
  constructor(call) {
    super(`host capability required: ${call.capability}`);
    this.call = call;
  }
}

function capabilityClient(results) {
  let sequence = 0;
  const pending = [];
  const invoke = async (capability, request) => {
    const id = `${capability}:${sequence++}`;
    if (Object.hasOwn(results, id)) {
      const stored = results[id];
      return stored && stored.ok === true && Object.hasOwn(stored, "value") ? stored.value : stored;
    }
    const call = { id, capability, request };
    pending.push(call);
    throw new CapabilityRequired(call);
  };
  return { pending, capabilities: {
    context: {
      instructions: { list: (request) => invoke("context.instructions.list", request) },
      conversation: { recent: (request) => invoke("context.conversation.recent", request) },
    },
    llm: { evaluateJson: (request) => invoke("llm.evaluateJson", request) },
    storage: {
      get: (request) => invoke("storage.get", request),
      set: (request) => invoke("storage.set", request),
      list: (request) => invoke("storage.list", request),
      delete: (request) => invoke("storage.delete", request),
    },
    notification: { send: (request) => invoke("notification.send", request) },
    island: {
      annotateSession: (request) => invoke("island.annotateSession", request),
      reportActivity: (request) => invoke("island.reportActivity", request),
      publishStatus: (request) => invoke("island.publishStatus", request),
      clear: (request) => invoke("island.clear", request),
    },
    log: { emit: (request) => invoke("log.emit", request) },
    signals: { emit: (request) => invoke("signals.emit", request) },
    usage: { record: (request) => invoke("usage.record", request) },
  } };
}

async function runEvent(envelope) {
  const capabilityState = capabilityClient(envelope.capabilityResults || {});
  const capabilities = capabilityState.capabilities;
  const payload = envelope.input || {};
  const input = {
    ...payload,
    organizationId: envelope.tenant.organizationId,
    userId: envelope.tenant.userId,
    plugins: new Map([[pluginId, { enabled: true, config: envelope.config || {} }]]),
  };
  switch (pluginId) {
    case "openleash.blast-radius":
      return completed(await pluginModule.runBlastRadius(input, capabilities), capabilityState);
    case "openleash.sensitive-access":
      return completed(await pluginModule.runSensitiveAccess(input, capabilities), capabilityState);
    case "openleash.rules-enforcer":
      return completed(await pluginModule.runSecurityEvaluator(input, capabilities), capabilityState);
    case "openleash.mcp-scanner": {
      const result = await pluginModule.runMcpScanner(input, capabilities);
      return completed({ run: result.run, mcpCall: result.call, results: [], model: "none" }, capabilityState);
    }
    case "openleash.code-scanner": {
      const run = await pluginModule.runCodeScanner(
        input.request,
        envelope.event,
        capabilities,
        envelope.config || {},
      );
      return completed({ run, results: [], model: String(run.metadata?.evaluatedBy || "none") }, capabilityState);
    }
    case "openleash.dlp": {
      const result = await pluginModule.runDlp({
        prompt: String(payload.prompt || input.request?.event?.prompt || ""),
        config: envelope.config || {},
        capabilities,
        startedAt: Date.now(),
      });
      return completed({
        prompt: result.prompt,
        run: result.run,
        ...(result.result || {}),
      }, capabilityState);
    }
    case "openleash.skill-scanner": {
      const result = await pluginModule.runSkillScanner(payload, capabilities);
      return completed({ ...result, runs: result.run ? [result.run] : [] }, capabilityState);
    }
    case "openleash.siem-exporter": {
      const run = envelope.event === "log.emitted"
        ? await pluginModule.runSiemLogExporter({ ...payload, config: envelope.config || {} })
        : await pluginModule.runSiemExporter({ ...payload, config: envelope.config || {} });
      return completed({ run, results: [], model: "none" }, capabilityState);
    }
    default:
      if (typeof pluginModule.runContainerEvent === "function") {
        return completed(await pluginModule.runContainerEvent({ envelope, payload, capabilities }), capabilityState);
      }
      throw new Error(`plugin ${pluginId} does not export a container event handler`);
  }
}

function completed(output, capabilityState) {
  if (capabilityState.pending.length > 0) throw new CapabilityRequired(capabilityState.pending[0]);
  return output;
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      return json(response, 200, { ok: true, pluginId, protocol });
    }
    if (request.method !== "POST" || request.url !== "/v1/events") {
      return json(response, 404, { error: "not found" });
    }
    const raw = await readBody(request);
    verifyRequest(request, raw);
    const envelope = JSON.parse(raw);
    if (envelope.protocol !== protocol || envelope.plugin?.id !== pluginId || !envelope.requestId) {
      return json(response, 400, { error: "incompatible plugin event envelope" });
    }
    try {
      const output = await runEvent(envelope);
      return json(response, 200, {
        protocol,
        requestId: envelope.requestId,
        status: "completed",
        output,
      });
    } catch (error) {
      if (error instanceof CapabilityRequired) {
        return json(response, 200, {
          protocol,
          requestId: envelope.requestId,
          status: "capability_required",
          capabilityRequests: [error.call],
        });
      }
      throw error;
    }
  } catch (error) {
    return json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0");

function verifyRequest(request, raw) {
  const secret = requiredEnv("OPENLEASH_PLUGIN_RUNTIME_SECRET");
  const timestamp = String(request.headers["x-openleash-timestamp"] || "");
  const signature = String(request.headers["x-openleash-signature"] || "").replace(/^sha256=/, "");
  if (request.headers["x-openleash-plugin-protocol"] !== protocol) throw new Error("invalid protocol header");
  if (request.headers["x-openleash-plugin-id"] !== pluginId) throw new Error("invalid plugin id header");
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60_000) throw new Error("stale plugin request");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const left = Buffer.from(signature, "hex");
  const right = Buffer.from(expected, "hex");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error("invalid plugin signature");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error("plugin request is too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
