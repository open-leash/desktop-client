import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const windowHtml = readFileSync(join(__dirname, "window.html"), "utf8");
const helperSource = windowHtml.match(
  /\/\* plugin-detail-edit-refresh:start \*\/([\s\S]*?)\/\* plugin-detail-edit-refresh:end \*\//,
)?.[1];

assert.ok(helperSource, "plugin detail edit refresh helper is present");

const shouldPreservePluginDetailEditor = new Function(
  `${helperSource}; return shouldPreservePluginDetailEditor;`,
)() as (view: string, tab: string, editorHasFocus: boolean) => boolean;

test("background refresh preserves a focused plugin settings editor", () => {
  assert.equal(
    shouldPreservePluginDetailEditor("plugin-detail", "settings", true),
    true,
  );
});

test("other plugin views still render background updates", () => {
  assert.equal(
    shouldPreservePluginDetailEditor("plugin-detail", "insights", true),
    false,
  );
  assert.equal(
    shouldPreservePluginDetailEditor("plugin-detail", "settings", false),
    false,
  );
  assert.equal(
    shouldPreservePluginDetailEditor("overview", "settings", true),
    false,
  );
});

test("renderer snapshots typed plugin settings into the existing draft", () => {
  assert.match(
    windowHtml,
    /detailSettings\?\.addEventListener\("input", persistDraft\)/,
  );
  assert.match(
    windowHtml,
    /pluginDetailDraftConfigs\[plugin\.id\] = collectPluginDetailConfig\(plugin\)/,
  );
});
