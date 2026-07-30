import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("pending attention refreshes account plugin state instead of using the local snapshot", () => {
  const main = readFileSync(path.join(__dirname, "main.ts"), "utf8");
  const branchStart = main.indexOf("if (notifications?.pending.length)");
  const branchEnd = main.indexOf("const [stateResponse, plugins, outcomes]", branchStart);
  assert.notEqual(branchStart, -1);
  assert.notEqual(branchEnd, -1);

  const pendingBranch = main.slice(branchStart, branchEnd);
  assert.match(pendingBranch, /fetchRemotePluginCatalog\(/);
  assert.match(pendingBranch, /fetchRemotePluginOutcomes\(/);
  assert.doesNotMatch(
    pendingBranch,
    /mergeTrayState\(\s*localState,\s*notifications,\s*localState\?\.plugins/,
  );
});

test("renderer derives installed and available lists from active plugin state", () => {
  const renderer = readFileSync(path.join(__dirname, "window.html"), "utf8");
  const installedStart = renderer.indexOf("function installedPlugins()");
  const installedEnd = renderer.indexOf("function pluginStatusLabel", installedStart);
  assert.notEqual(installedStart, -1);
  assert.notEqual(installedEnd, -1);

  const installState = renderer.slice(installedStart, installedEnd);
  assert.match(
    installState,
    /function installedPlugins\(\) \{\s*return \(state\.plugins \|\| \[\]\)\.filter\(pluginInstalled\);/,
  );
  assert.match(
    installState,
    /function availablePlugins\(\) \{\s*return \(state\.plugins \|\| \[\]\)\.filter\(\(plugin\) => !pluginInstalled\(plugin\)\);/,
  );
  assert.match(installState, /plugin\?\.settings\?\.enabled === true/);
  assert.doesNotMatch(installState, /plugin\?\.settings\?\.installedVersion/);
});
