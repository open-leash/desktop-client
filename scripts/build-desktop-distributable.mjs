#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackage = JSON.parse(
  fs.readFileSync(path.join(root, "apps", "desktop", "package.json"), "utf8"),
);
const version = String(desktopPackage.version ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid desktop package version: ${version || "missing"}`);
}

const windows = process.argv.includes("--windows");
const platformArgs = windows ? ["--win", "--x64"] : ["--mac", "--arm64"];
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const args = [
  "electron-builder",
  "--config",
  "electron-builder.personal.yml",
  `--config.extraMetadata.version=${version}`,
  ...platformArgs,
];

console.log(`[leash:desktop-package] building ${version} for ${windows ? "Windows x64" : "macOS arm64"}`);
const result = spawnSync(executable, args, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
