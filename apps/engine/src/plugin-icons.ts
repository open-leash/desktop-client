export const FIRST_PARTY_PLUGIN_ICONS: Readonly<Record<string, string>> = {
  "token-saver": "✂️",
  "blast-radius": "💥",
  "data-leakage-prevention": "🤫",
  "mcp-scanner": "📡",
  "rules-enforcer": "📏",
  "sensitive-access": "🔐",
  "skill-scanner": "🕵️",
  "code-scanner": "☣️",
};

export function pluginIconText(slug: string) {
  const selected = FIRST_PARTY_PLUGIN_ICONS[slug];
  if (selected) return selected;
  const parts = slug.split(/[-_\s.]+/).filter(Boolean);
  if (parts.length > 1) {
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }
  return slug.slice(0, 2).toUpperCase() || "OL";
}
