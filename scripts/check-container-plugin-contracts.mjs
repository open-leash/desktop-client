import fs from "node:fs";
import path from "node:path";
import { FIRST_PARTY_PLUGIN_MANIFESTS } from "../packages/shared/dist/index.js";

const production = process.env.OPENLEASH_RELEASE_MODE === "production";
const failures = [];
const gatewayDockerfile = fs.readFileSync("plugins/container-runtime/Dockerfile.gateway", "utf8");
if (!/^FROM\s+\S+@sha256:[a-f0-9]{64}/m.test(gatewayDockerfile)) failures.push("plugin gateway: base image must be digest-pinned");
const runtimeSource = fs.readFileSync("apps/client-api/src/plugins/runtime.ts", "utf8");
if (/from\s+["']\.\/(?:blast-radius|sensitive-access|security-evaluator|mcp-scanner|code-scanner|dlp|prompt-compression|skill-scanner|siem-exporter)\//.test(runtimeSource)) {
  failures.push("client-api runtime imports an in-process plugin implementation");
}
for (const plugin of FIRST_PARTY_PLUGIN_MANIFESTS) {
  const execution = plugin.execution;
  if (plugin.runtime !== "container") failures.push(`${plugin.id}: every plugin runtime must be container`);
  if (!execution || execution.type !== "container") failures.push(`${plugin.id}: missing container execution block`);
  if (execution?.protocol !== "openleash-container-plugin.v1") failures.push(`${plugin.id}: unsupported protocol`);
  if (!execution?.image || !/:\d/.test(execution.image)) failures.push(`${plugin.id}: image must use a versioned tag`);
  if (production && !/^sha256:[a-f0-9]{64}$/.test(execution?.digest ?? "")) {
    failures.push(`${plugin.id}: production release requires an immutable sha256 digest`);
  }
  if (!execution?.eventPath) failures.push(`${plugin.id}: generic event endpoint is missing`);
  if (plugin.events.includes("provider.request.beforeSend") && !execution?.transformPath) failures.push(`${plugin.id}: provider transform endpoint is missing`);
  if (plugin.events.includes("provider.request.beforeSend") && !plugin.permissions.includes("provider-request:read")) failures.push(`${plugin.id}: provider request read permission is missing`);
  if (plugin.events.includes("provider.request.beforeSend") && plugin.effects.includes("transform") && !plugin.permissions.includes("provider-request:write")) {
    failures.push(`${plugin.id}: transform effect requires provider request write permission`);
  }
  const slug = plugin.slug ?? plugin.id.replace(/^openleash\./, "");
  const dockerfile = path.resolve(`plugins/plugin-${slug}/Dockerfile`);
  if (plugin.publisher === "openleash" && !fs.existsSync(dockerfile)) failures.push(`${plugin.id}: ${dockerfile} is missing`);
  if (plugin.publisher === "openleash" && fs.existsSync(dockerfile)) {
  const source = fs.readFileSync(dockerfile, "utf8");
  if (!/^FROM\s+\S+@sha256:[a-f0-9]{64}/m.test(source)) failures.push(`${plugin.id}: Dockerfile base image must be digest-pinned`);
  if (!/^HEALTHCHECK\s+/m.test(source)) failures.push(`${plugin.id}: Dockerfile must declare HEALTHCHECK`);
  }
  validateFirstPartyReferences(plugin);
}

for (const file of fs.readdirSync("plugins").filter((name) => name.startsWith("plugin-") && name !== "plugin-token-saver")) {
  if (!fs.existsSync(path.join("plugins", file, "Dockerfile"))) failures.push(`${file}: Dockerfile is missing`);
}

function validateFirstPartyReferences(plugin) {
  const slug = plugin.id === "openleash.prompt-compression" ? "token-saver" : plugin.slug;
  const packagePath = `plugins/plugin-${slug}/package.json`;
  if (!fs.existsSync(packagePath)) return;
  const packageVersion = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
  if (packageVersion !== plugin.version) failures.push(`${slug}: package ${packageVersion} differs from shared manifest ${plugin.version}`);
  if (plugin.id !== "openleash.prompt-compression") return;
  for (const file of ["plugins/plugin-token-saver/src/manifest.ts", "apps/desktop-client/src/plugin-catalog.ts"]) {
    const source = fs.readFileSync(file, "utf8");
    const marker = source.indexOf('id: "openleash.prompt-compression"');
    const block = source.slice(marker, source.indexOf('\n  {\n    id: "', marker + 1) < 0 ? source.length : source.indexOf('\n  {\n    id: "', marker + 1));
    if (!block.includes(`version: "${plugin.version}"`)) failures.push(`token-saver: ${file} has a different version`);
    if (!block.includes(`image: "${plugin.execution.image}"`)) failures.push(`token-saver: ${file} has a different image tag`);
    if (plugin.execution.digest && !block.includes(`digest: "${plugin.execution.digest}"`)) failures.push(`token-saver: ${file} has a different digest`);
  }
  const expected = plugin.execution.digest
    ? `${plugin.execution.image}@${plugin.execution.digest}`
    : plugin.execution.image;
  for (const file of ["docker-compose.yml", "deploy/kubernetes/token-saver-pool.yaml"]) {
    if (!fs.readFileSync(file, "utf8").includes(`image: ${expected}`)) failures.push(`token-saver: ${file} is not pinned to ${expected}`);
  }
  const pool = fs.readFileSync("deploy/kubernetes/token-saver-pool.yaml", "utf8");
  if (!pool.includes('"openleash.prompt-compression":"http://openleash-token-saver:8080"')) {
    failures.push("token-saver: Kubernetes pool does not publish the Token Saver endpoint");
  }
  const cloudPatch = fs.readFileSync("deploy/kubernetes/cloud-client-api-plugin-runtime-patch.yaml", "utf8");
  for (const variable of ["OPENLEASH_PLUGIN_ENDPOINTS", "OPENLEASH_PLUGIN_RUNTIME_SECRET"]) {
    if (!cloudPatch.includes(`name: ${variable}`)) failures.push(`token-saver: cloud client-api patch is missing ${variable}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Container plugin contracts are valid.");
