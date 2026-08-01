#!/usr/bin/env node
import fs from "node:fs";

const args = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const name = process.argv[index];
  if (name.startsWith("--")) args[name.slice(2)] = process.argv[index + 1];
}
const version = String(args.version ?? "").trim();
const digest = String(args.digest ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("--version must be semver");
if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
  throw new Error("--digest must be the immutable GHCR sha256 digest for this exact version");
}
const pluginPackagePath = "plugins/plugin-token-saver/package.json";
const pluginPackage = JSON.parse(fs.readFileSync(pluginPackagePath, "utf8"));
pluginPackage.version = version;
fs.writeFileSync(pluginPackagePath, `${JSON.stringify(pluginPackage, null, 2)}\n`);

const manifestFiles = [
  "plugins/plugin-token-saver/src/manifest.ts",
  "packages/shared/src/index.ts",
  "apps/desktop-client/src/plugin-catalog.ts",
];
for (const file of manifestFiles) {
  let source = fs.readFileSync(file, "utf8");
  const marker = source.indexOf('id: "openleash.prompt-compression"');
  if (marker < 0) throw new Error(`${file} has no Token Saver manifest`);
  const nextPlugin = source.indexOf('\n  {\n    id: "', marker + 1);
  const end = nextPlugin < 0 ? source.length : nextPlugin;
  let block = source.slice(marker, end);
  block = block.replace(/version: "[^"]+"/, `version: "${version}"`);
  block = block.replace(/image: "(?:ghcr\.io\/open-leash\/(?:plugin-)?token-saver|openleash\/token-saver):[^"]+"/, `image: "ghcr.io/open-leash/plugin-token-saver:${version}"`);
  if (/\n\s*digest:/.test(block)) block = block.replace(/digest: "sha256:[a-f0-9]+"/, `digest: "${digest}"`);
  else block = block.replace(/(image: "ghcr\.io\/open-leash\/plugin-token-saver:[^"]+",)/, `$1\n      digest: "${digest}",`);
  source = source.slice(0, marker) + block + source.slice(end);
  fs.writeFileSync(file, source);
}

const imageFiles = [
  ["docker-compose.yml", /image: (?:ghcr\.io\/open-leash\/(?:plugin-)?token-saver|openleash\/token-saver):[^\s]+/g, `image: ghcr.io/open-leash/plugin-token-saver:${version}@${digest}`],
  ["deploy/kubernetes/token-saver-pool.yaml", /image: (?:ghcr\.io\/open-leash\/(?:plugin-)?token-saver|openleash\/token-saver):[^\s]+/g, `image: ghcr.io/open-leash/plugin-token-saver:${version}@${digest}`],
  ["deploy/docker/individual-open-source.compose.yml", /OPENLEASH_TOKEN_SAVER_VERSION:-[^}]+/g, `OPENLEASH_TOKEN_SAVER_VERSION:-${version}@${digest}`],
  ["deploy/docker/private-cloud.compose.yml", /OPENLEASH_TOKEN_SAVER_VERSION:-[^}]+/g, `OPENLEASH_TOKEN_SAVER_VERSION:-${version}@${digest}`],
  ["scripts/install-openleash-personal.sh", /OPENLEASH_TOKEN_SAVER_VERSION:-[^}]+/g, `OPENLEASH_TOKEN_SAVER_VERSION:-${version}@${digest}`],
];
for (const [file, pattern, replacement] of imageFiles) {
  const source = fs.readFileSync(file, "utf8");
  const updated = source.replace(pattern, replacement);
  // Release publication may prepare the immutable reference before the
  // multi-app conductor runs. Treat the exact desired value as idempotent,
  // while still failing when neither the old pattern nor the desired pin is
  // present.
  if (updated === source && !source.includes(replacement.replace(/^image: /, "")) && !source.includes(replacement)) {
    throw new Error(`${file} did not contain the expected Token Saver image reference`);
  }
  fs.writeFileSync(file, updated);
}
console.log(`Prepared Token Saver ${version} at ${digest}.`);
