#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const org = process.argv[2] ?? "open-leash";
const requestedApps = new Set(process.argv.slice(3));
const appsDir = path.resolve("apps");
const apps = fs.readdirSync(appsDir)
  .filter((entry) => fs.statSync(path.join(appsDir, entry)).isDirectory())
  .filter((entry) => requestedApps.size === 0 || requestedApps.has(entry))
  .sort();

if (apps.length === 0) {
  console.error("No apps found.");
  process.exit(1);
}

run("gh", ["auth", "status"]);

for (const appName of apps) {
  const source = path.join(appsDir, appName);
  const repo = `${org}/${appName}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `openleash-${appName}-`));
  console.log(`\n==> ${repo}`);
  const exists = spawnSync("gh", ["repo", "view", repo], { stdio: "ignore" }).status === 0;

  if (exists) {
    run("git", ["clone", `https://github.com/${repo}.git`, temp]);
  } else {
    run("git", ["init", "-b", "main"], { cwd: temp });
  }

  run("rsync", [
    "-a",
    "--delete",
    "--exclude", ".git",
    "--exclude", ".DS_Store",
    "--exclude", ".env",
    "--exclude", ".env.*",
    "--exclude", "tsconfig.tsbuildinfo",
    "--exclude", "node_modules",
    "--exclude", ".dev",
    "--exclude", ".next",
    "--exclude", "dist",
    "--exclude", "build",
    "--exclude", ".dart_tool",
    "--exclude", ".flutter-plugins-dependencies",
    "--exclude", ".idea",
    "--exclude", "*.iml",
    "--exclude", "*.pem",
    "--exclude", "*.p12",
    "--exclude", "*.mobileprovision",
    "--exclude", "GoogleService-Info.plist",
    "--exclude", "google-services.json",
    "--exclude", "key.properties",
    "--exclude", "*.keystore",
    "--exclude", "*.jks",
    "--exclude", "android/local.properties",
    "--exclude", "ios/Pods",
    "--exclude", "ios/.symlinks",
    "--exclude", "ios/Flutter/Generated.xcconfig",
    "--exclude", "ios/Flutter/flutter_export_environment.sh",
    `${source}/`,
    `${temp}/`
  ]);

  removeGeneratedOutputs(temp);
  run("find", [temp, "(", "-name", ".DS_Store", "-o", "-name", "tsconfig.tsbuildinfo", ")", "-delete"]);
  run("git", ["add", "."], { cwd: temp });
  if (gitHasChanges(temp)) {
    run("git", [
      "-c", "user.name=OpenLeash Initializer",
      "-c", "user.email=hello@openleash.com",
      "commit",
      "-m",
      exists ? `Sync ${appName} app` : `Initial ${appName} app`
    ], { cwd: temp });
  } else {
    console.log(`${repo} is already up to date.`);
  }

  if (!gitHasCommits(temp)) {
    console.log(`${repo} has no files after exclusions; skipping empty repository push.`);
    fs.rmSync(temp, { recursive: true, force: true });
    continue;
  }

  if (exists) {
    console.log(`${repo} already exists; synced local app contents.`);
  } else {
    run("gh", ["repo", "create", repo, "--private", "--description", descriptionFor(appName)]);
    run("git", ["remote", "add", "origin", `https://github.com/${repo}.git`], { cwd: temp });
  }

  run("git", ["push", "-u", "origin", "main"], { cwd: temp });
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("\nAll app repos pushed.");

function descriptionFor(appName) {
  const descriptions = {
    "client-api": "Client-facing OpenLeash API for hooks, evaluation, enrollment, mobile, and updates.",
    "dashboard-api": "Dashboard/admin API surface for OpenLeash.",
    "dashboard-web": "OpenLeash dashboard web app for policies, identity, deployment, and audit.",
    "desktop-client": "OpenLeash desktop client, local API, tray app, and hook installer.",
    "flow-viewer": "Local observability UI for OpenLeash agent-event pipeline traces.",
    "docs-web": "OpenLeash documentation site.",
    "main-web": "OpenLeash product website.",
    "mobile-client": "OpenLeash iOS/Android approval companion.",
    "cloud-client-api": "Private OpenLeash Cloud wrapper over the public client API.",
    "cloud-dashboard-api": "Private OpenLeash Cloud wrapper over the public dashboard API.",
    "cloud-dashboard-web": "Private OpenLeash Cloud wrapper over the public dashboard web app."
  };
  return descriptions[appName] ?? `OpenLeash ${appName}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

function gitHasChanges(cwd) {
  return spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd,
    stdio: "ignore"
  }).status !== 0;
}

function gitHasCommits(cwd) {
  return spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd,
    stdio: "ignore"
  }).status === 0;
}

function removeGeneratedOutputs(root) {
  for (const relativePath of [
    "node_modules",
    ".dev",
    ".next",
    "dist",
    "build",
    ".dart_tool",
    ".flutter-plugins-dependencies",
    ".idea",
    "android/local.properties",
    "key.properties",
    "GoogleService-Info.plist",
    "google-services.json",
    "ios/Pods",
    "ios/.symlinks",
    "ios/Flutter/Generated.xcconfig",
    "ios/Flutter/flutter_export_environment.sh"
  ]) {
    fs.rmSync(path.join(root, relativePath), { recursive: true, force: true });
  }
}
