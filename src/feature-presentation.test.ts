import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer = readFileSync(path.join(__dirname, "window.html"), "utf8");

test("desktop uses one plain-language name for every built-in Feature", () => {
  for (const name of [
    "Destruction Protection",
    "Code Scanner",
    "Private Data Protection",
    "Connected Tools",
    "Token Saver",
    "Your Rules",
    "Secret Access Protection",
    "Instruction Safety",
  ]) {
    assert.match(renderer, new RegExp(`name: "${name}"`));
  }
  assert.match(renderer, /category: "protection"/);
  assert.match(renderer, /category: "cost"/);
});

test("Feature cards hide compatibility slugs and show enabled state", () => {
  const setupCards = renderer.slice(
    renderer.indexOf("function setupPluginInstallCards()"),
    renderer.indexOf("function pluginSearchText", renderer.indexOf("function setupPluginInstallCards()")),
  );
  assert.match(setupCards, /<strong>\$\{escapeHtml\(pluginName\(plugin\)\)\}<\/strong>/);
  assert.doesNotMatch(setupCards, /<small>\$\{escapeHtml\(pluginName\(plugin\)\)\}<\/small>/);
  assert.doesNotMatch(setupCards, /pluginPackageName\(plugin\)/);
  assert.doesNotMatch(setupCards, /plugin\.(?:slug|name|id)\}/);
  assert.doesNotMatch(setupCards, /Click (?:for details|to collapse)/);
  assert.doesNotMatch(setupCards, /"Disable"/);
  assert.match(setupCards, /checked \? "Enabled" : "Enable"/);
});

test("desktop groups built-in Features into Protections and Costs", () => {
  assert.match(renderer, /\{ id: "protection", label: "Protections"/);
  assert.match(renderer, /\{ id: "cost", label: "Costs"/);
  assert.doesNotMatch(renderer, /\{ id: "security", label: "Security"/);
});

test("setup explains Features in consumer language", () => {
  assert.match(renderer, /Choose your protection/);
  assert.match(renderer, /protections and cost controls that matter to you/);
  assert.match(renderer, /Search protections and cost controls/);
  assert.doesNotMatch(renderer, /Choose from the first-party Features included with Leash\. They run in the API/);
});
