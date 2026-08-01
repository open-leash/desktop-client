#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const scopeFlagIndex = process.argv.indexOf("--scope");
const scope = scopeFlagIndex >= 0 ? process.argv[scopeFlagIndex + 1] : "full";
if (!new Set(["public", "full"]).has(scope)) {
  console.error("Usage: check-deployment-readiness.mjs [--scope public|full]");
  process.exit(2);
}

const fullCompositionPrefixes = [
  "apps/cloud-client-api/",
  "apps/cloud-dashboard-api/",
  "apps/cloud-dashboard-web/"
];

const checks = [
  ["desktop installer script", "scripts/install-openleash-personal.sh"],
  ["desktop electron-builder config", "electron-builder.personal.yml"],
  ["desktop package", "apps/desktop-client/package.json"],
  ["client-api Dockerfile", "apps/client-api/Dockerfile"],
  ["client-api product mode capabilities", "apps/client-api/src/product-mode.ts"],
  ["dashboard-web Dockerfile", "apps/dashboard-web/Dockerfile"],
  ["Individual Open Source compose", "deploy/docker/individual-open-source.compose.yml"],
  ["Private Cloud compose", "deploy/docker/private-cloud.compose.yml"],
  ["Docker image publisher", "scripts/docker-images.mjs"],
  ["cloud client-api Dockerfile", "apps/cloud-client-api/Dockerfile"],
  ["cloud client-api Cloud Build", "apps/cloud-client-api/cloudbuild.yaml"],
  ["cloud dashboard-api Dockerfile", "apps/cloud-dashboard-api/Dockerfile"],
  ["cloud dashboard-api Cloud Build", "apps/cloud-dashboard-api/cloudbuild.yaml"],
  ["cloud dashboard-web Dockerfile", "apps/cloud-dashboard-web/Dockerfile"],
  ["cloud dashboard-web Cloud Build", "apps/cloud-dashboard-web/cloudbuild.yaml"],
  ["Token Saver container image", "plugins/plugin-token-saver/Dockerfile"],
  ["isolated plugin gateway image", "plugins/container-runtime/Dockerfile.gateway"],
  ["container plugin contract gate", "scripts/check-container-plugin-contracts.mjs"],
  ["cloud Token Saver warm pool", "deploy/kubernetes/token-saver-pool.yaml"],
  ["cloud event-plugin warm pools", "deploy/kubernetes/event-plugin-pools.yaml"],
  ["third-party container plugin example", "examples/container-plugin/openleash.plugin.json"],
  ["identity loader Dockerfile", "IdentityLoader/IdentityLoader/Dockerfile"],
  ["deployment docs", "docs/DEPLOYMENT.md"],
  ["run.py launcher", "run.py"],
  ["mode runner", "scripts/run-openleash.py"]
];

const contentChecks = [
  ["electron-builder pins Electron version", "electron-builder.personal.yml", /electronVersion:\s*40\.10\.6/],
  ["installer supports enrollment", "scripts/install-openleash-personal.sh", /--enroll/],
  ["installer supports tenant URL", "scripts/install-openleash-personal.sh", /--tenant/],
  ["installer supports hook install", "scripts/install-openleash-personal.sh", /--install-hooks/],
  ["installer supports Individual Open Source", "scripts/install-openleash-personal.sh", /--open-source/],
  ["package can publish Docker images", "package.json", /docker:publish/],
  ["release gate validates container plugins", "package.json", /check-container-plugin-contracts/],
  ["Individual Open Source routes installed plugins through the loopback gateway", "deploy/docker/individual-open-source.compose.yml", /openleash\.blast-radius.*http:\/\/host\.docker\.internal:9349/],
  ["Private Cloud composes isolated event plugins", "deploy/docker/private-cloud.compose.yml", /openleash\.sensitive-access.*http:\/\/sensitive-access:8080/],
  ["private/cloud runner starts IdentityLoader", "scripts/run-openleash.py", /identity-loader/],
  ["runner supports Individual Open Source", "scripts/run-openleash.py", /"individual-open-source"/],
  ["runner exposes IdentityLoader URL", "scripts/run-openleash.py", /IDENTITY_LOADER_URL/],
  ["runner supports public cloud", "scripts/run-openleash.py", /"public-cloud"/],
  ["runner supports private cloud", "scripts/run-openleash.py", /"private-cloud"/],
  ["client-api image exposes API ports", "apps/client-api/Dockerfile", /EXPOSE\s+9318\s+9319/],
  ["dashboard-web image exposes dashboard port", "apps/dashboard-web/Dockerfile", /EXPOSE\s+9300/],
  ["Individual Open Source compose uses published client-api image", "deploy/docker/individual-open-source.compose.yml", /\/client-api:/],
  ["client-api exposes product-mode capability boundary", "apps/client-api/src/product-mode.ts", /individual-open-source[\s\S]*singleUserRuntime[\s\S]*orgManagement/],
  ["product architecture forbids client-api app split", "docs/PRODUCT_ARCHITECTURE.md", /Do not fork it into a separate individual API and organization API/],
  ["cloud client-api listens on Cloud Run port", "apps/cloud-client-api/Dockerfile", /ENV PORT=8080/],
  ["cloud dashboard-api listens on Cloud Run port", "apps/cloud-dashboard-api/Dockerfile", /ENV PORT=8080/],
  ["cloud dashboard-web listens on Cloud Run port", "apps/cloud-dashboard-web/Dockerfile", /ENV PORT=8080/],
  ["IdentityLoader container exposes HTTP", "IdentityLoader/IdentityLoader/Dockerfile", /EXPOSE\s+8080/],
  ["deployment docs mention managed self-hosted", "docs/DEPLOYMENT.md", /Managed Self-Hosted/],
  ["deployment docs mention OpenLeash Cloud", "docs/DEPLOYMENT.md", /Managed OpenLeash Cloud/]
];

const absentContentChecks = [
  ["runner does not expose standalone", "scripts/run-openleash.py", /"standalone"/],
  ["package scripts do not expose standalone mode", "package.json", /dev:mode:standalone/],
  ["VS Code launch does not expose standalone mode", ".vscode/launch.json", /dev:mode:standalone|Local Mode/],
  ["VS Code tasks do not expose standalone mode", ".vscode/tasks.json", /dev:mode:standalone|Local Mode/],
  ["deployment docs do not advertise standalone", "docs/DEPLOYMENT.md", /## Standalone/],
  ["Individual Open Source compose does not include dashboard", "deploy/docker/individual-open-source.compose.yml", /dashboard-web|dashboard-api/]
];

const packageChecks = [
  ["root author set for electron-builder", "package.json", (pkg) => Boolean(pkg.author)],
  ["root package version matches desktop release", "package.json", (pkg) => pkg.version === JSON.parse(fs.readFileSync("apps/desktop-client/package.json", "utf8")).version],
  ["desktop has Electron dependency", "apps/desktop-client/package.json", (pkg) => Boolean(pkg.dependencies?.electron || pkg.devDependencies?.electron)],
  ["client-api has build script", "apps/client-api/package.json", (pkg) => Boolean(pkg.scripts?.build)],
  ["dashboard-web has build script", "apps/dashboard-web/package.json", (pkg) => Boolean(pkg.scripts?.build)],
  ["cloud-client-api has build script", "apps/cloud-client-api/package.json", (pkg) => Boolean(pkg.scripts?.build)],
  ["cloud-dashboard-api has build script", "apps/cloud-dashboard-api/package.json", (pkg) => Boolean(pkg.scripts?.build)],
  ["cloud-dashboard-web has build script", "apps/cloud-dashboard-web/package.json", (pkg) => Boolean(pkg.scripts?.build)]
];

const failures = [];

for (const [label, file] of checks) {
  if (!shouldCheck(file)) continue;
  if (!fs.existsSync(file)) failures.push(`${label}: missing ${file}`);
}

for (const [label, file, pattern] of contentChecks) {
  if (!shouldCheck(file)) continue;
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (!pattern.test(text)) failures.push(`${label}: ${file} did not match ${pattern}`);
}

for (const [label, file, pattern] of absentContentChecks) {
  if (!shouldCheck(file)) continue;
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (pattern.test(text)) failures.push(`${label}: ${file} unexpectedly matched ${pattern}`);
}

for (const [label, file, predicate] of packageChecks) {
  if (!shouldCheck(file)) continue;
  if (!fs.existsSync(file)) continue;
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!predicate(pkg)) failures.push(`${label}: failed`);
  } catch (error) {
    failures.push(`${label}: could not parse ${file}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error("Deployment readiness failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Deployment readiness ok (${scope})`);

function shouldCheck(file) {
  return scope === "full" || !fullCompositionPrefixes.some((prefix) => file.startsWith(prefix));
}
