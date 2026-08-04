import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer = readFileSync(path.join(__dirname, "window.html"), "utf8");
const helperSource = renderer.match(
  /\/\* setup-install-progress:start \*\/([\s\S]*?)\/\* setup-install-progress:end \*\//,
)?.[1];

assert.ok(helperSource, "setup installation progress helper is present");

const setupAgentFill = new Function(
  `${helperSource}; return setupAgentFill;`,
)() as (percent: number, index: number, total: number) => number;

test("selected agent icons fill with color from left to right", () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => setupAgentFill(0, index, 4)),
    [0, 0, 0, 0],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => setupAgentFill(37.5, index, 4)),
    [100, 50, 0, 0],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => setupAgentFill(100, index, 4)),
    [100, 100, 100, 100],
  );
});

test("active installation uses a dedicated screen with no back control", () => {
  const start = renderer.indexOf("function renderSetupInstallation()");
  const end = renderer.indexOf("function renderSetup()", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const installationView = renderer.slice(start, end);

  assert.match(installationView, /setupInstallScreen/);
  assert.match(installationView, /class="gray"/);
  assert.match(installationView, /class="color"/);
  assert.match(installationView, /OpenLeash is installed/);
  assert.doesNotMatch(installationView, /id="setupBack"/);
  assert.match(
    renderer,
    /document\.body\.classList\.toggle\("setup-locked", isSetupSurfaceActive\(\)\)/,
  );
});

test("desktop setup reports real installation stages to the renderer", () => {
  const main = readFileSync(path.join(__dirname, "main.ts"), "utf8");
  const preload = readFileSync(path.join(__dirname, "preload.ts"), "utf8");
  const start = main.indexOf('"openleash:setup"');
  const end = main.indexOf('"openleash:uninstall-agent-protection"', start);
  const setupHandler = main.slice(start, end);

  assert.match(setupHandler, /openleash:setup-progress/);
  assert.match(setupHandler, /Enrolling this Mac/);
  assert.match(setupHandler, /Protecting \$\{agentDisplayName\}/);
  assert.match(setupHandler, /Verifying agent protection/);
  assert.match(setupHandler, /Verifying plugin containers/);
  assert.match(setupHandler, /reconcilePluginContainers/);
  assert.match(setupHandler, /verifyRemotePluginRuntimes/);
  assert.match(setupHandler, /percent: 100/);
  assert.match(preload, /onSetupProgress/);
});
