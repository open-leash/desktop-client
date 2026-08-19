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
  assert.deepEqual(canonicalPresentations.map((feature) => feature.name), [
    "Destructive Protection",
    "Code Protection",
    "Private Data Protection",
    "Secret Protection",
    "Prompt Injection Protection",
    "Tool Protection",
    "Rules Protection",
    "Token Saver",
  ]);
  assert.equal(canonicalPresentations.some((feature) => /^Leash\b/.test(feature.name)), false);
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

test("desktop groups built-in Features into plain-language Safety and Cost control sections", () => {
  assert.match(renderer, /\{ id: "protection", label: "Safety"/);
  assert.match(renderer, /\{ id: "cost", label: "Cost control"/);
  assert.doesNotMatch(renderer, /\{ id: "security", label: "Security"/);
});

test("desktop Overview focuses on monitored activity and Agents owns enablement", () => {
  assert.match(renderer, /function overviewActivitySummary\(inventory\)/);
  assert.match(renderer, /function overviewActivitySnapshotHtml\(summary, inventory\)/);
  assert.match(renderer, /Actions monitored/);
  assert.match(renderer, /Threats blocked/);
  assert.match(renderer, /Passed safely/);
  assert.match(renderer, /Approved by you/);
  assert.doesNotMatch(renderer, /Automatically approved/);
  assert.match(renderer, /Threats and sensitive actions/);
  assert.match(renderer, /Agents by kind/);
  assert.match(renderer, /\{ view: "agents", label: "Agents" \}/);
  assert.match(renderer, /class="card overviewAgentsHead"/);
  assert.match(renderer, /function overviewDeviceHtml\(\)/);
  assert.match(renderer, /<img src="devices\/\$\{device\.image\}"/);
  assert.match(renderer, /Synced \$\{escapeHtml\(synced\)\}/);
  assert.match(renderer, /agent \? agentIcon\(agent\)/);
  const overview = renderer.slice(renderer.indexOf("function renderOverview()"), renderer.indexOf("function cloudTrialBannerHtml()"));
  assert.doesNotMatch(overview, /overviewAgentGrid|data-overview-agent/);
  const agents = renderer.slice(renderer.indexOf("function renderAgents()"), renderer.indexOf("function renderUsage()"));
  assert.match(agents, /overviewAgentGrid/);
  assert.match(agents, /bindAgentMonitoringSwitches\(renderAgents\)/);
  assert.match(renderer, /id="backOverview">Agents<\/button>/);
  assert.match(copyAssets, /copyDeviceImages\(\)/);
  assert.match(copyAssets, /windows-desktop\.png/);
});

test("Feature details use a consistent status switch, Summary, and audit history", () => {
  const detail = renderer.slice(renderer.indexOf("function renderPluginDetail()"), renderer.indexOf("function renderPluginRuleImport()"));
  assert.match(detail, /role="switch" aria-checked=/);
  assert.match(detail, /data-feature-state/);
  assert.match(detail, />Summary<\/button>/);
  assert.match(detail, /Protection activity/);
  assert.match(detail, /Actions monitored/);
  assert.match(detail, /Passed safely/);
  assert.match(detail, /pluginAuditColumns/);
  assert.match(detail, /Protection history/);
  assert.match(detail, /pluginSettingsSurface/);
  assert.doesNotMatch(detail, /At a glance|Built into Leash/);
});

test("setup explains Features in consumer language", () => {
  assert.match(renderer, /\{ id: "features", title: "Your protection"/);
  assert.match(renderer, /const currentId = current\.id \|\| current\.title\.toLowerCase\(\)/);
  assert.match(renderer, /Your protection/);
  assert.match(renderer, /Meet the built-in Features Leash turns on automatically/);
  assert.match(renderer, /Protection, already switched on/);
  assert.match(renderer, /Leash is the antivirus for AI/);
  assert.match(renderer, /Leash starts protecting you right away/);
  assert.match(renderer, /When should Leash warn you\?/);
  assert.match(renderer, /Most code changes/);
  assert.doesNotMatch(renderer, /Minimum Code Characters|Notification Risk Threshold/);
});

test("Feature settings keep technical controls behind a plain Advanced layer", () => {
  assert.match(renderer, /<summary>Advanced settings<\/summary>/);
  assert.match(renderer, /The recommended values are safe to keep/);
  assert.match(renderer, /Exact warning score \(0–100\)/);
  assert.match(renderer, /Evaluation model override/);
  assert.match(renderer, /const advancedOnlySettingKeys = new Set/);
  assert.match(renderer, /const advancedExactSettingKeys = new Set/);
});
