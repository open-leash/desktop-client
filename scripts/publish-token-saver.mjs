#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const pkg = JSON.parse(fs.readFileSync("plugins/plugin-token-saver/package.json", "utf8"));
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const version = valueAfter("--version") ?? pkg.version;
const image = `${valueAfter("--registry") ?? process.env.OPENLEASH_PLUGIN_IMAGE_REGISTRY ?? "ghcr.io/open-leash"}/plugin-token-saver:${version}`;
const scanImage = `${image}-release-scan`;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Token Saver version must be semver");
if (spawnSync("docker", ["buildx", "imagetools", "inspect", image], { stdio: "ignore" }).status === 0) {
  throw new Error(`${image} already exists. Bump the Token Saver version; published version tags are immutable.`);
}

run("docker", ["buildx", "build", "--load", "--tag", scanImage, "plugins/plugin-token-saver"]);
if (available("trivy")) {
  // Debian occasionally has high-severity findings with no vendor fix. Block every
  // fixable HIGH/CRITICAL finding; keep the full unfiltered report available in CI.
  run("trivy", ["image", "--scanners", "vuln", "--ignore-unfixed", "--severity", "HIGH,CRITICAL", "--exit-code", "1", scanImage]);
} else {
  run("docker", ["scout", "cves", "--only-severity", "critical,high", "--exit-code", scanImage]);
}
run("docker", [
  "buildx", "build",
  "--platform", valueAfter("--platforms") ?? "linux/amd64,linux/arm64",
  "--provenance=true", "--sbom=true",
  "--tag", image,
  "--push",
  "plugins/plugin-token-saver",
]);
const inspection = run("docker", ["buildx", "imagetools", "inspect", image], true);
const digest = inspection.match(/^Digest:\s*(sha256:[a-f0-9]{64})$/m)?.[1];
if (!digest) throw new Error(`Could not read the immutable digest for ${image}`);
run("node", ["scripts/prepare-token-saver-release.mjs", "--version", version, "--digest", digest]);
run("node", ["scripts/verify-token-saver-public.mjs", "--version", version, "--digest", digest]);
run("npm", ["run", "test:container-plugins"], false, { OPENLEASH_RELEASE_MODE: "production" });
console.log(JSON.stringify({ image, digest, prepared: true }, null, 2));

function run(command, args, capture = false, env = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  return result.stdout ?? "";
}

function available(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}
