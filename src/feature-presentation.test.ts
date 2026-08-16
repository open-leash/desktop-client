import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer = readFileSync(path.join(__dirname, "window.html"), "utf8");
const copyAssets = readFileSync(path.join(__dirname, "copy-assets.mjs"), "utf8");
const canonicalPresentations = JSON.parse(
  readFileSync(path.join(__dirname, "../../../packages/shared/feature-presentations.json"), "utf8"),
) as Array<{ id: string; slug: string; name: string; description: string }>;
const mobilePresentationsPath = path.join(
  __dirname,
  "../../mobile-client/lib/feature_presentations.g.dart",
);
const mobilePresentations = existsSync(mobilePresentationsPath)
  ? readFileSync(mobilePresentationsPath, "utf8")
  : null;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("one canonical presentation supplies every built-in Feature surface", () => {
  assert.equal(canonicalPresentations.length, 8);
  assert.equal(new Set(canonicalPresentations.map((feature) => feature.id)).size, 8);
  assert.equal(new Set(canonicalPresentations.map((feature) => feature.name)).size, 8);
  if (mobilePresentations) {
    for (const feature of canonicalPresentations) {
      assert.match(mobilePresentations, new RegExp(escapeRegExp(feature.name)));
      assert.match(mobilePresentations, new RegExp(escapeRegExp(feature.description)));
    }
  }
  assert.match(renderer, /__LEASH_FEATURE_PRESENTATIONS__/);
  assert.match(copyAssets, /feature-presentations\.json/);
  assert.match(copyAssets, /replace\(\s*"__LEASH_FEATURE_PRESENTATIONS__"/);
  assert.match(copyAssets, /copyWorkspaceRuntimeDependencies\(\)/);
  assert.match(copyAssets, /"@openleash", "shared"/);
});

test("setup showcases Features without installation controls", () => {
  const setupCards = renderer.slice(
    renderer.indexOf("function setupFeatureShowcaseCards()"),
    renderer.indexOf("function setupPluginInstallCards()", renderer.indexOf("function setupFeatureShowcaseCards()")),
  );
  assert.match(setupCards, /setupFeatureGrid/);
  assert.match(setupCards, /setupFeatureCard/);
  assert.match(setupCards, /<strong>\$\{escapeHtml\(pluginName\(plugin\)\)\}<\/strong>/);
  assert.match(setupCards, /On automatically/);
  assert.doesNotMatch(setupCards, /<input|checkbox|data-plugin-install|\bEnable\b|\bDisable\b/);
  assert.match(renderer, /\.setupFeatureGrid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("desktop groups built-in Features into Protections and Costs", () => {
  assert.match(renderer, /\{ id: "protection", label: "Protections"/);
  assert.match(renderer, /\{ id: "cost", label: "Costs"/);
  assert.doesNotMatch(renderer, /\{ id: "security", label: "Security"/);
});

test("setup explains Features in consumer language", () => {
  assert.match(renderer, /\{ id: "features", title: "Your protection"/);
  assert.match(renderer, /const currentId = current\.id \|\| current\.title\.toLowerCase\(\)/);
  assert.match(renderer, /Your protection/);
  assert.match(renderer, /Meet the built-in Features Leash turns on automatically/);
  assert.match(renderer, /Protection, already switched on/);
  assert.match(renderer, /Leash is the antivirus for AI/);
  assert.match(renderer, /Complete protection from day one/);
});
