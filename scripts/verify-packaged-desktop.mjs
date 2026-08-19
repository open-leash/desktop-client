#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractFile } = require("@electron/asar");

const root = process.cwd();
const app = path.join(root, "release/personal/mac-arm64/Leash.app");
const executable = path.join(app, "Contents/MacOS/Leash");
const packagedApp = path.join(app, "Contents/Resources/app.asar");
const nativeModule = path.join(
  app,
  "Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
);
const nativeIsland = path.join(
  app,
  "Contents/Resources/app.asar.unpacked/apps/desktop-client/dist/openleash-island",
);
const nativeIslandHtml = path.join(
  app,
  "Contents/Resources/app.asar.unpacked/apps/desktop-client/dist/notice.html",
);
const nativeIslandClaudeIcon = path.join(
  app,
  "Contents/Resources/app.asar.unpacked/apps/desktop-client/dist/agent-icons/claude.svg",
);
const nativeIslandOpenLeashIcon = path.join(
  app,
  "Contents/Resources/app.asar.unpacked/apps/desktop-client/dist/openleash-icon.png",
);
const nativeIslandCodexMascot = path.join(
  app,
  "Contents/Resources/app.asar.unpacked/apps/desktop-client/dist/agent-mascots/codex-pet.webp",
);
const nativeIslandFireworks = path.join(
  app,
  "Contents/Resources/app.asar.unpacked/apps/desktop-client/dist/Fireworks.json",
);
const nativeIslandLottie = path.join(
  app,
  "Contents/Resources/app.asar.unpacked/apps/desktop-client/dist/lottie.min.js",
);
const nativeProxy = path.join(
  app,
  "Contents/Resources/local-proxy/openleash-local-proxy",
);

for (const required of [
  executable,
  packagedApp,
  nativeModule,
  nativeIsland,
  nativeIslandHtml,
  nativeIslandClaudeIcon,
  nativeIslandOpenLeashIcon,
  nativeIslandCodexMascot,
  nativeIslandFireworks,
  nativeIslandLottie,
  nativeProxy,
]) {
  if (!fs.existsSync(required)) throw new Error(`Missing packaged file: ${required}`);
}

const proxyResult = spawnSync(nativeProxy, ["--help"], { encoding: "utf8" });
if (proxyResult.status !== 0 || !/openleash-local-proxy/i.test(`${proxyResult.stdout}\n${proxyResult.stderr}`)) {
  throw new Error("Packaged native local proxy could not execute");
}
console.log("packaged native local proxy ok");

const expectedVersion = JSON.parse(
  fs.readFileSync(path.join(root, "apps/desktop-client/package.json"), "utf8"),
).version;
const packagedMetadata = JSON.parse(extractFile(packagedApp, "package.json").toString("utf8"));
if (packagedMetadata.version !== expectedVersion) {
  throw new Error(`Packaged desktop version ${packagedMetadata.version} does not match ${expectedVersion}`);
}

const packagedWindow = extractFile(
  packagedApp,
  "apps/desktop-client/dist/window.html",
).toString("utf8");
if (packagedWindow.includes("Leash Cloud starts free with your provider")) {
  throw new Error("Packaged Cloud setup still offers the retired customer-provider flow");
}
if (!packagedWindow.includes("Select agents to manage.")) {
  throw new Error("Packaged setup does not contain the agent-selection flow");
}
console.log("packaged setup reaches agent selection without the retired provider page");

const noticeHtml = fs.readFileSync(nativeIslandHtml, "utf8");
if (noticeHtml.includes("__OPENLEASH_FIREWORKS_DATA__")) {
  throw new Error("Packaged notice still contains the unexpanded fireworks placeholder");
}
if (!noticeHtml.includes("animationData") || !noticeHtml.includes('"v":"5.1.4"')) {
  throw new Error("Packaged notice does not contain the embedded Lottie fireworks data");
}

const result = spawnSync(
  executable,
  ["-e", `require(${JSON.stringify(nativeModule)}); console.log('packaged better-sqlite3 ABI ok')`],
  {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  throw new Error(`Packaged desktop native-module verification failed with exit ${result.status}`);
}

const catalogModule = path.join(
  app,
  "Contents/Resources/app.asar/apps/desktop-client/dist/plugin-catalog.js",
);
const catalogResult = spawnSync(
  executable,
  [
    "-e",
    `const catalog=require(${JSON.stringify(catalogModule)});` +
      `if(catalog.bundledFirstPartyPlugins.length!==8)throw new Error('Expected 8 built-in Features');` +
      `console.log('packaged shared runtime and Feature catalog ok')`,
  ],
  {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  },
);

if (catalogResult.stdout) process.stdout.write(catalogResult.stdout);
if (catalogResult.stderr) process.stderr.write(catalogResult.stderr);
if (catalogResult.status !== 0) {
  throw new Error(`Packaged desktop shared-runtime verification failed with exit ${catalogResult.status}`);
}
