#!/usr/bin/env node
import fs from "node:fs";

const forbiddenPaths = ["IdentityLoader", "apps/dashboard-api", "apps/dashboard-web", "plugins/container-runtime"];
const failures = forbiddenPaths.filter((path) => fs.existsSync(path));
const modules = fs.readFileSync(".gitmodules", "utf8");
if (/dashboard-(?:api|web)|IdentityLoader|plugins\/plugin-/.test(modules)) failures.push("retired public submodule in .gitmodules");
const packageJson = fs.readFileSync("package.json", "utf8");
if (/dashboard-(?:api|web)|provider-mgmt-sync/.test(packageJson)) failures.push("retired workspace in package.json");
if (failures.length) {
  console.error("Public boundary audit failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("Leash personal public boundary ok");
