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
    "Connected Tool Awareness",
    "AI Cost Control",
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
  assert.doesNotMatch(setupCards, /"Disable"/);
  assert.match(setupCards, /checked \? "Enabled" : "Enable"/);
});

test("desktop groups built-in Features into Protections and Costs", () => {
  assert.match(renderer, /\{ id: "protection", label: "Protections"/);
  assert.match(renderer, /\{ id: "cost", label: "Costs"/);
  assert.doesNotMatch(renderer, /\{ id: "security", label: "Security"/);
});
