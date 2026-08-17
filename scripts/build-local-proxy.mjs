#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceCandidates = [
  process.env.OPENLEASH_LOCAL_PROXY_SOURCE,
  path.resolve(desktopRoot, "..", "local-proxy"),
].filter(Boolean);
const sourceRoot = sourceCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, "Cargo.toml")),
);

if (!sourceRoot) {
  throw new Error(
    `Could not find the Leash local-proxy source. Checked: ${sourceCandidates.join(", ")}`,
  );
}

const targetDir = path.join(desktopRoot, "build", "local-proxy-target");
const outputDir = path.join(desktopRoot, "build", "local-proxy");
const executable = process.platform === "win32"
  ? "openleash-local-proxy.exe"
  : "openleash-local-proxy";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const result = spawnSync(
  cargo,
  ["build", "--locked", "--release", "--manifest-path", path.join(sourceRoot, "Cargo.toml")],
  {
    cwd: sourceRoot,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const built = path.join(targetDir, "release", executable);
const bundled = path.join(outputDir, executable);
if (!fs.existsSync(built)) throw new Error(`Cargo did not produce ${built}`);
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(built, bundled);
if (process.platform !== "win32") fs.chmodSync(bundled, 0o755);
console.log(`[leash:local-proxy] bundled native proxy: ${bundled}`);
