const PLUGIN_SLUG_ALIASES: Record<string, string> = {
  "blast radius": "blast-radius",
  "prompt-compression": "token-saver",
  "prompt compression": "token-saver",
  "token-compression": "token-saver",
  "token compression": "token-saver",
  "token saver": "token-saver",
  dlp: "data-leakage-prevention",
};

export function canonicalPluginSlug(value: unknown, fallback = "openleash-core") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (raw.toLowerCase() === "openleash.core") return "openleash-core";
  const unscoped = raw.replace(/^openleash\./i, "");
  const lower = unscoped.toLowerCase();
  return PLUGIN_SLUG_ALIASES[lower] ?? lower.replace(/[\s_]+/g, "-");
}
