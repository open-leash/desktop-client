import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const html = fs.readFileSync(path.join(__dirname, "window.html"), "utf8");

test("desktop setup starts with a Personal or Business choice", () => {
  assert.match(html, /\{ title: "Account", subtitle: "Choose Personal or Business\." \}/);
  assert.match(html, /audienceChoice\("individual", "Personal"/);
  assert.match(html, /audienceChoice\("organization", "Business"/);
});

test("Personal setup offers Cloud and Open Source", () => {
  assert.match(html, /connectionChoice\("cloud", orgCloud \? "Leash Business Cloud" : "Leash Cloud"/);
  assert.match(html, /connectionChoice\("custom", "Personal Open Source"/);
});

test("Personal setup requires an AI provider before agents are installed", () => {
  assert.match(html, /\{ title: "AI provider", subtitle: "Connect the AI Leash will use for safety checks\." \}/);
  assert.match(html, /Add your AI provider key before continuing\./);
  assert.match(html, /await saveRemoteModelKey\(\)/);
  assert.match(html, /platform\.openai\.com\/api-keys/);
  assert.match(html, /platform\.claude\.com\/settings\/keys/);
  assert.match(html, /api-docs\.deepseek\.com\/api\/deepseek-api/);
});

test("Business is preserved and restricted to Leash Cloud", () => {
  assert.match(html, /if \(setupAudience === "organization"\) setupClientMode = "cloud";/);
  assert.doesNotMatch(html, /setupAudience = "individual";\s*if \(setupClientMode === "personal"\)/);
  assert.match(html, /setupAudience === "individual" \? connectionChoice\("custom"/);
});
