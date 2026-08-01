import http from "node:http";

const protocol = "openleash-container-plugin.v1";
const targets = JSON.parse(process.env.OPENLEASH_PLUGIN_TARGETS || "{}");

const server = http.createServer(async (request, response) => {
  const pluginId = String(request.headers["x-openleash-plugin-id"] || "");
  const target = targets[pluginId];
  if (!target) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unknown plugin" }));
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const requestUrl = new URL(request.url || "/", "http://plugin-gateway");
    const pluginPrefix = `/v1/plugins/${encodeURIComponent(pluginId)}`;
    let upstreamPath = requestUrl.pathname.startsWith(pluginPrefix)
      ? requestUrl.pathname.slice(pluginPrefix.length) || "/"
      : requestUrl.pathname;
    if (upstreamPath === "/transform") upstreamPath = "/v1/transform";
    const upstreamUrl = new URL(`http://${target}:8080${upstreamPath}`);
    upstreamUrl.search = requestUrl.search;
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: Object.fromEntries(
        Object.entries(request.headers)
          .filter(([name]) => !["host", "connection", "content-length"].includes(name))
          .map(([name, value]) => [name, Array.isArray(value) ? value.join(",") : String(value ?? "")]),
      ),
      body: ["GET", "HEAD"].includes(request.method || "GET") ? undefined : Buffer.concat(chunks),
      signal: AbortSignal.timeout(35_000),
    });
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(8080, "0.0.0.0");
