#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const forbiddenPaths = [
  "AGENTS.md",
  "IdentityLoader",
  "backup-ol2.py",
  "build.py",
  "release.py",
  "run.py",
  "test.py",
  "apps/dashboard-api",
  "apps/dashboard-web",
  "apps/cloud-client-api",
  "apps/cloud-dashboard-api",
  "apps/cloud-dashboard-web",
  "apps/main-web",
  "apps/docs-web",
  "plugins/container-runtime",
  "snapshots/dashboard-api",
  "snapshots/cloud-client-api",
  "snapshots/cloud-dashboard-api",
];
const tracked = new Set(
  execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((file) => file && fs.existsSync(file)),
);
const failures = forbiddenPaths.filter((path) => [...tracked].some((file) => file === path || file.startsWith(`${path}/`)));
const modules = fs.existsSync(".gitmodules") ? fs.readFileSync(".gitmodules", "utf8") : "";
if (/dashboard-(?:api|web)|IdentityLoader|plugins\/plugin-/.test(modules)) failures.push("retired public submodule in .gitmodules");
const packageJson = fs.readFileSync("package.json", "utf8");
if (/dashboard-(?:api|web)|provider-mgmt-sync/.test(packageJson)) failures.push("retired workspace in package.json");
if (failures.length) {
  console.error("Public boundary audit failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("Leash personal public boundary ok");
