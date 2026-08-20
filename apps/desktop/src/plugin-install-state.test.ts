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

test("dashboard activity is cleared when the desktop tenant session changes", () => {
  const main = readFileSync(path.join(__dirname, "main.ts"), "utf8");
  const fetchStart = main.indexOf("async function fetchTrayState()");
  const fetchEnd = main.indexOf("async function fetchLocalTrayState()", fetchStart);
  const fetchSource = main.slice(fetchStart, fetchEnd);
  assert.match(fetchSource, /const activitySummaryKey = `\$\{remoteApiUrl\}\\0\$\{remoteToken\}`/);
  assert.match(fetchSource, /if \(latestActivitySummaryKey !== activitySummaryKey\) \{\s*latestActivitySummary = undefined;/);
  assert.match(fetchSource, /if \(!remoteApiUrl \|\| !remoteToken\) \{\s*latestActivitySummary = undefined;/);
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
  assert.match(renderer, /<span class="navLabel">More from Leash<\/span>/);
});

test("fresh setup selects every runtime-available Feature by default", () => {
  const renderer = readFileSync(path.join(__dirname, "window.html"), "utf8");
  const helperSource = renderer.match(
    /\/\* development-plugin-selection:start \*\/([\s\S]*?)\/\* development-plugin-selection:end \*\//,
  )?.[1];
  assert.ok(helperSource);
  const helpers = new Function(
    `${helperSource}; return { isDevelopmentDesktopRenderer, defaultPluginSelectionIds };`,
  )() as {
    isDevelopmentDesktopRenderer: (pathname: string) => boolean;
    defaultPluginSelectionIds: (
      plugins: Array<{ id: string; settings?: { runtimeAvailable?: boolean } }>,
    ) => string[];
  };

  assert.equal(
    helpers.isDevelopmentDesktopRenderer(
      "/Users/max/Code/OL2/apps/desktop-client/.dev/OpenLeash.app/Contents/Resources/app.asar/dist/window.html",
    ),
    true,
  );
  assert.equal(
    helpers.isDevelopmentDesktopRenderer(
      "/Applications/OpenLeash.app/Contents/Resources/app.asar/dist/window.html",
    ),
    false,
  );
  assert.deepEqual(
    helpers.defaultPluginSelectionIds([
      { id: "openleash.ready" },
      { id: "openleash.available", settings: { runtimeAvailable: true } },
      { id: "openleash.unavailable", settings: { runtimeAvailable: false } },
    ]),
    ["openleash.ready", "openleash.available"],
  );
  assert.match(
    renderer,
    /selectedPlugins = pluginSelectionTouched && selectedPlugins[\s\S]*new Set\(defaultPluginSelectionIds\(plugins\)\)/,
  );
  assert.match(
    renderer,
    /function enableEverySetupFeature\(\) \{\s*selectedPlugins = new Set\(defaultPluginSelectionIds\(state\.plugins\)\)/,
  );
  assert.match(renderer, /enableEverySetupFeature\(\);\s*setupInstallProgress = \{ percent: 12/);
  const featureStep = renderer.slice(
    renderer.indexOf('currentId === "features"'),
    renderer.indexOf('setupStep >= steps.length', renderer.indexOf('currentId === "features"')),
  );
  assert.match(featureStep, /setupFeatureShowcaseCards\(\)/);
  assert.doesNotMatch(featureStep, /setupPluginInstallCards\(\)|data-plugin-install|checkbox/);
});
