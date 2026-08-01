import crypto from "node:crypto";
import http from "node:http";

const protocol = "openleash-container-plugin.v1";
const pluginId = "acme.command-review";
const secret = String(process.env.OPENLEASH_PLUGIN_RUNTIME_SECRET || "");

http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    return send(response, 200, { ok: true, pluginId, protocol });
  }
  if (request.method !== "POST" || request.url !== "/v1/events") {
    return send(response, 404, { error: "not found" });
  }
  const raw = await body(request);
  const timestamp = String(request.headers["x-openleash-timestamp"] || "");
  const supplied = String(request.headers["x-openleash-signature"] || "").replace(/^sha256=/, "");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  if (!secret || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return send(response, 401, { error: "invalid signature" });
  }
  const envelope = JSON.parse(raw);
  if (envelope.protocol !== protocol || envelope.plugin?.id !== pluginId) {
    return send(response, 409, { error: "incompatible envelope" });
  }
  const command = String(envelope.input?.request?.event?.tool?.input?.command || "");
  const destructive = /\brm\s+-rf\b|\bdrop\s+table\b/i.test(command);
  const result = destructive ? [{
    policyId: "acme.command-review.destructive",
    policyName: "Destructive command",
    status: "needs_question",
    severity: "high",
    explanation: "The command may destroy local data.",
    evidence: [command.slice(0, 240)],
    question: "Allow this destructive command?"
  }] : [];
  return send(response, 200, {
    protocol,
    requestId: envelope.requestId,
    status: "completed",
    output: {
      results: result,
      model: "none",
      run: {
        pluginId,
        event: envelope.event,
        status: destructive ? "needs_question" : "passed",
        summary: destructive ? "Destructive command needs approval." : "Command passed review."
      }
    }
  });
}).listen(8080, "0.0.0.0");

function body(request) {
  return new Promise((resolve, reject) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { value += chunk; });
    request.on("end", () => resolve(value));
    request.on("error", reject);
  });
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
