const apiUrl = String(process.env.OPENLEASH_CLIENT_API_URL ?? "http://127.0.0.1:9318").replace(/\/+$/, "");
const token = process.env.OPENLEASH_ADMIN_TOKEN ?? process.env.OPENLEASH_DASHBOARD_TOKEN;
const intervalMs = Math.max(30_000, Number(process.env.OPENLEASH_PULL_INTERVAL_MS ?? 300_000));
const providers = String(process.env.OPENLEASH_PULL_PROVIDERS ?? "salesforce-agentforce,google-vertex-ai,microsoft-copilot-studio")
  .split(",").map((value) => value.trim()).filter(Boolean);

if (!token) throw new Error("OPENLEASH_ADMIN_TOKEN or OPENLEASH_DASHBOARD_TOKEN is required.");

async function syncProvider(provider: string) {
  const response = await fetch(`${apiUrl}/admin/external-agents/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ provider }),
    signal: AbortSignal.timeout(Math.min(intervalMs, 240_000))
  });
  const body = await response.json().catch(() => ({})) as { synced?: unknown[]; skipped?: unknown[]; error?: string };
  if (!response.ok) throw new Error(`${provider}: ${body.error ?? response.statusText}`);
  console.log(JSON.stringify({ level: "info", event: "provider_sync", provider, synced: body.synced?.length ?? 0, skipped: body.skipped?.length ?? 0, at: new Date().toISOString() }));
}

async function cycle() {
  const results = await Promise.allSettled(providers.map(syncProvider));
  for (const result of results) {
    if (result.status === "rejected") console.error(JSON.stringify({ level: "error", event: "provider_sync_failed", error: result.reason instanceof Error ? result.reason.message : String(result.reason), at: new Date().toISOString() }));
  }
}

await cycle();
setInterval(() => void cycle(), intervalMs);
