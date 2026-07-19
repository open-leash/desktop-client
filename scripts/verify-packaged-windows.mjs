#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

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

for (const required of [executable, nativeModule]) {
  if (!fs.existsSync(required)) throw new Error(`Missing packaged file: ${required}`);
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
