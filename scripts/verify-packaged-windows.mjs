#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { listPackage } = require("@electron/asar");

const root = process.cwd();
const unpacked = path.join(root, "release", "windows", "win-unpacked");
const executable = path.join(unpacked, "OpenLeash.exe");
const nativeModule = path.join(
  unpacked,
  "resources",
  "app.asar.unpacked",
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
const packagedApp = path.join(unpacked, "resources", "app.asar");
const expectedDistAssets = [
  path.join(root, "dist", "agent-mascots", "codex-pet.webp"),
  path.join(root, "dist", "THIRD_PARTY_NOTICES.md"),
];

for (const required of [executable, nativeModule, packagedApp, ...expectedDistAssets]) {
  if (!fs.existsSync(required)) throw new Error(`Missing packaged file: ${required}`);
}

const packagedFiles = new Set(listPackage(packagedApp));
for (const required of [
  "/dist/main.js",
  "/dist/notice.html",
  "/dist/agent-mascots/codex-pet.webp",
  "/dist/THIRD_PARTY_NOTICES.md",
]) {
  if (!packagedFiles.has(required)) throw new Error(`Missing file in packaged app.asar: ${required}`);
}

if (process.platform !== "win32") {
  console.log("Packaged Windows layout, island assets, and native module are present (runtime ABI check requires Windows).");
  process.exit(0);
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
  throw new Error(`Packaged Windows native-module verification failed with exit ${result.status}`);
}
