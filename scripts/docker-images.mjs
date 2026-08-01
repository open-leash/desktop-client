#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { spawnSync } from "node:child_process";

const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tokenSaverPackage = JSON.parse(fs.readFileSync("plugins/plugin-token-saver/package.json", "utf8"));
const eventPluginSlugs = [
  "blast-radius",
  "sensitive-access",
  "data-leakage-prevention",
  "rules-enforcer",
  "mcp-scanner",
  "code-scanner",
  "skill-scanner",
  "siem-exporter",
];
const eventPluginPackages = eventPluginSlugs.map((slug) => ({
  slug,
  package: JSON.parse(fs.readFileSync(`plugins/plugin-${slug}/package.json`, "utf8")),
}));
const args = process.argv.slice(2);
const shouldPush = args.includes("--push");
const includeCloud = args.includes("--include-cloud");
const includeWeb = args.includes("--include-web");
const version = valueAfter("--version") ?? process.env.OPENLEASH_VERSION ?? rootPackage.version ?? "latest";
const registry = stripTrailingSlash(valueAfter("--registry") ?? process.env.OPENLEASH_IMAGE_REGISTRY ?? "ghcr.io/open-leash");
const pluginRegistry = stripTrailingSlash(valueAfter("--plugin-registry") ?? process.env.OPENLEASH_PLUGIN_IMAGE_REGISTRY ?? "ghcr.io/open-leash");
const platform = valueAfter("--platform") ?? process.env.OPENLEASH_DOCKER_PLATFORM;
const latest = !args.includes("--no-latest");

const publicImages = [
  {
    name: "local-proxy",
    dockerfile: "apps/local-proxy/Dockerfile",
    context: "apps/local-proxy"
  },
  {
    name: "provider-puller",
    dockerfile: "apps/provider-puller/Dockerfile",
    context: "apps/provider-puller"
  },
  {
    name: "client-api",
    dockerfile: "apps/client-api/Dockerfile",
    context: "apps/client-api"
  },
  {
    name: "dashboard-web",
    dockerfile: "apps/dashboard-web/Dockerfile",
    context: "apps/dashboard-web"
  },
  {
    name: "plugin-token-saver",
    dockerfile: "plugins/plugin-token-saver/Dockerfile",
    context: "plugins/plugin-token-saver",
    registry: pluginRegistry,
    version: tokenSaverPackage.version,
    latest: false
  },
  {
    name: "plugin-gateway",
    dockerfile: "plugins/container-runtime/Dockerfile.gateway",
    context: ".",
    registry: pluginRegistry,
    version: "1.0.0",
    latest: false
  },
  ...eventPluginPackages.map(({ slug, package: pluginPackage }) => ({
    name: `plugin-${slug}`,
    dockerfile: `plugins/plugin-${slug}/Dockerfile`,
    context: ".",
    registry: pluginRegistry,
    version: pluginPackage.version,
    latest: false,
  })),
];

const webImages = [
  {
    name: "main-web",
    dockerfile: "apps/main-web/Dockerfile",
    context: "apps/main-web"
  },
  {
    name: "docs-web",
    dockerfile: "apps/docs-web/Dockerfile",
    context: "apps/docs-web"
  }
];

const cloudImages = [
  {
    name: "cloud-client-api",
    dockerfile: "apps/cloud-client-api/Dockerfile",
    context: "apps/cloud-client-api"
  },
  {
    name: "cloud-dashboard-api",
    dockerfile: "apps/cloud-dashboard-api/Dockerfile",
    context: "apps/cloud-dashboard-api"
  },
  {
    name: "cloud-dashboard-web",
    dockerfile: "apps/cloud-dashboard-web/Dockerfile",
    context: "apps/cloud-dashboard-web"
  }
];

const images = [
  ...publicImages,
  ...(includeWeb ? webImages : []),
  ...(includeCloud ? cloudImages : [])
];

if (images.some((image) => image.name.startsWith("plugin-") && image.name !== "plugin-token-saver")) {
  run("npm", ["run", "build", "-w", "@openleash/shared"]);
  for (const { slug } of eventPluginPackages) {
    run("npm", ["run", "build", "--prefix", `plugins/plugin-${slug}`]);
  }
}

for (const image of images) {
  build(image);
}

console.log(`[docker] ${shouldPush ? "published" : "built"} ${images.length} image(s) for ${version}`);

function build(image) {
  const names = [image.name, ...(image.aliases ?? [])];
  const imageRegistry = image.registry ?? registry;
  const imageVersion = image.version ?? version;
  const tags = names.map((name) => `${imageRegistry}/${name}:${imageVersion}`);
  if (latest && image.latest !== false) tags.push(...names.map((name) => `${imageRegistry}/${name}:latest`));
  const commandArgs = ["build"];
  if (platform) commandArgs.push("--platform", platform);
  for (const tag of tags) commandArgs.push("-t", tag);
  commandArgs.push("-f", image.dockerfile, image.context);
  run("docker", commandArgs);
  if (shouldPush) {
    for (const tag of tags) run("docker", ["push", tag]);
  }
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function run(command, commandArgs) {
  console.log(`[docker] ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
