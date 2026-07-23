const aliases = {
  "blast radius": "blast-radius",
  "prompt-compression": "token-saver",
  "prompt compression": "token-saver",
  "token-compression": "token-saver",
  "token compression": "token-saver",
  "token saver": "token-saver",
  dlp: "data-leakage-prevention",
};

export function canonicalPluginSlug(value, fallback = "openleash-core") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (raw.toLowerCase() === "openleash.core") return "openleash-core";
  const unscoped = raw.replace(/^openleash\./i, "");
  const lower = unscoped.toLowerCase();
  return aliases[lower] || lower.replace(/[\s_]+/g, "-");
}

export function canonicalPluginText(value) {
  return String(value ?? "")
    .replace(/(?:prompt|token)[ -]compression(?: plugin)?/gi, "token-saver")
    .replace(/token saver/gi, "token-saver")
    .replace(/blast radius/gi, "blast-radius");
}
