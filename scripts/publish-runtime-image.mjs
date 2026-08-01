#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const name = valueAfter("--name");
const version = valueAfter("--version");
const dockerfile = valueAfter("--dockerfile");
const context = valueAfter("--context");
const registry = (valueAfter("--registry") ?? "ghcr.io/open-leash").replace(/\/$/, "");
const platforms = valueAfter("--platforms") ?? "linux/amd64,linux/arm64";
const deferPublic = process.argv.includes("--defer-public");
if (!name || !version || !dockerfile || !context) {
  throw new Error("--name, --version, --dockerfile, and --context are required");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("--version must be semver");
const image = `${registry}/${name}:${version}`;
if (spawnSync("docker", ["buildx", "imagetools", "inspect", image], { stdio: "ignore" }).status === 0) {
  throw new Error(`${image} already exists; published version tags are immutable`);
}
const scanImage = `${image}-release-scan`;
run("docker", ["buildx", "build", "--load", "-f", dockerfile, "-t", scanImage, context]);
if (!available("trivy")) throw new Error("Trivy is required for runtime image releases");
run("trivy", ["image", "--scanners", "vuln", "--ignore-unfixed", "--severity", "HIGH,CRITICAL", "--exit-code", "1", scanImage]);
run("docker", ["buildx", "build", "--platform", platforms, "--provenance=true", "--sbom=true", "-f", dockerfile, "-t", image, "--push", context]);
const inspection = run("docker", ["buildx", "imagetools", "inspect", image], true);
const digest = inspection.match(/^Digest:\s*(sha256:[a-f0-9]{64})$/m)?.[1];
if (!digest) throw new Error(`could not read digest for ${image}`);
if (!deferPublic) await verifyPublic(name, version, digest);
console.log(JSON.stringify({ image, digest, publicVerified: !deferPublic }, null, 2));

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  return result.stdout ?? "";
}

function available(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

async function verifyPublic(packageName, tag, expectedDigest) {
  const scope = `repository:open-leash/${packageName}:pull`;
  const tokenResponse = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`);
  if (!tokenResponse.ok) throw new Error(`${packageName} is not public in GHCR (anonymous token HTTP ${tokenResponse.status})`);
  const token = (await tokenResponse.json()).token;
  const response = await fetch(`https://ghcr.io/v2/open-leash/${packageName}/manifests/${tag}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.oci.image.index.v1+json" },
  });
  const digest = response.headers.get("docker-content-digest");
  if (!response.ok || digest !== expectedDigest) throw new Error(`anonymous manifest verification failed for ${packageName}:${tag}`);
}
