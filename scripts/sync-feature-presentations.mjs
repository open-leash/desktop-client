import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "packages/shared/feature-presentations.json");
const tsPath = path.join(root, "packages/shared/src/feature-presentations.ts");
const dartPath = path.join(root, "apps/mobile/lib/feature_presentations.g.dart");
const webPath = path.join(root, "apps/main-web/app/feature-presentations.generated.ts");
const features = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

const escapeDart = (value) => String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");

const tsEntries = features.map((feature) => `  ${JSON.stringify(feature.slug)}: ${JSON.stringify(feature, null, 2).split("\n").join("\n  ")},`).join("\n");
const aliases = features.flatMap((feature) => [
  [feature.id, feature.slug],
  ...(feature.slug === "token-saver" ? [["prompt-compression", feature.slug]] : []),
  ...(feature.slug === "data-leakage-prevention" ? [["dlp", feature.slug]] : []),
]);
const ts = `export type LeashFeaturePresentation = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: "protection" | "cost";
  iconText: string;
  showcaseOrder: number;
};

export const LEASH_FEATURE_PRESENTATIONS = {
${tsEntries}
} as const satisfies Record<string, LeashFeaturePresentation>;

export type LeashFeatureSlug = keyof typeof LEASH_FEATURE_PRESENTATIONS;

const featureAliases: Record<string, LeashFeatureSlug> = ${JSON.stringify(Object.fromEntries(aliases), null, 2)};

export function leashFeaturePresentation(value: string | undefined | null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const slug = featureAliases[normalized] ?? normalized as LeashFeatureSlug;
  return LEASH_FEATURE_PRESENTATIONS[slug];
}

export const LEASH_FEATURE_SHOWCASE = Object.values(LEASH_FEATURE_PRESENTATIONS)
  .sort((left, right) => left.showcaseOrder - right.showcaseOrder);
`;

const dartEntries = features.map((feature) => `  '${escapeDart(feature.slug)}': {
    'name': '${escapeDart(feature.name)}',
    'description':
        '${escapeDart(feature.description)}',
  },`).join("\n");
const dart = `// Generated from packages/shared/feature-presentations.json.
// Run \`node scripts/sync-feature-presentations.mjs\` after editing the source.

const leashFeaturePresentations = <String, Map<String, String>>{
${dartEntries}
};
`;

const web = `// Generated from packages/shared/feature-presentations.json.
// Run \`node scripts/sync-feature-presentations.mjs\` from the platform checkout after editing the source.

export const LEASH_FEATURE_PRESENTATIONS = ${JSON.stringify(Object.fromEntries(features.map((feature) => [feature.slug, feature])), null, 2)} as const;

export type LeashFeatureSlug = keyof typeof LEASH_FEATURE_PRESENTATIONS;

const featureAliases: Record<string, LeashFeatureSlug> = ${JSON.stringify(Object.fromEntries(aliases), null, 2)};

export function leashFeaturePresentation(value: string | undefined | null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const slug = (featureAliases[normalized] ?? normalized) as LeashFeatureSlug;
  return LEASH_FEATURE_PRESENTATIONS[slug];
}
`;

const outputs = [[tsPath, ts], [dartPath, dart]];
if (fs.existsSync(path.dirname(webPath))) outputs.push([webPath, web]);
if (process.argv.includes("--check")) {
  const stale = outputs.filter(([target, content]) => !fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content);
  if (stale.length) {
    console.error(`Feature presentation files are stale: ${stale.map(([target]) => path.relative(root, target)).join(", ")}`);
    process.exit(1);
  }
} else {
  for (const [target, content] of outputs) fs.writeFileSync(target, content);
}
