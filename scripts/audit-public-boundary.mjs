#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const publicWorkspaces = [
  "apps/client-api",
  "apps/dashboard-api",
  "apps/dashboard-web",
  "apps/desktop-client",
  "apps/docs-web",
  "apps/main-web",
  "apps/mobile-client",
  "apps/provider-mgmt-sync",
  "packages/shared"
];
const privateCloudWorkspaces = [
  "apps/cloud-client-api",
  "apps/cloud-dashboard-api",
  "apps/cloud-dashboard-web"
];
const publicRuntimeDirs = [
  "apps/client-api/src",
  "apps/dashboard-api/src",
  "apps/dashboard-web/app",
  "apps/dashboard-web/components",
  "apps/dashboard-web/lib",
  "apps/desktop-client/src",
  "apps/mobile-client/lib",
  "packages/shared/src"
];
const ignoredDirs = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".dart_tool",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "release",
  "dashboard-old",
  "IdentityLoader",
  "design-txample",
  "cloud-client-api",
  "cloud-dashboard-api",
  "cloud-dashboard-web",
  "private",
  "cloud-private",
  "openleash-cloud-private",
  "other-apps"
]);

const ignoredFiles = new Set([".env"]);
const denied = [
  {
    name: "committed secret value",
    pattern: /(OPENAI_API_KEY|ANTHROPIC_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|GOOGLE_CLIENT_SECRET|OPENLEASH_GOOGLE_CLIENT_SECRET)\s*=\s*['"]?[A-Za-z0-9_\-]{12,}/
  },
  {
    name: "OpenAI-style API key",
    pattern: /\bsk-[A-Za-z0-9_\-]{20,}\b/
  }
];
const deniedPublicRuntime = [
  {
    name: "private OpenLeash package import in public runtime",
    pattern: /(?:from\s+["']|import\s*\(["']|require\(["'])@openleash-private\//
  },
  {
    name: "private cloud workspace import in public runtime",
    pattern: /(?:from\s+["']|import\s*\(["']|require\(["']).*(?:apps\/cloud-|cloud-client-api|cloud-dashboard-api|cloud-dashboard-web)/
  }
];
const deniedPublicApiImplementation = [
  {
    name: "hosted billing implementation belongs in cloud wrappers",
    pattern: /\b(stripe|paddle|billing|subscription|invoice)\b/i
  },
  {
    name: "hosted quota or plan enforcement belongs in cloud wrappers",
    pattern: /\b(quota|monthly_event_limit|plan[_-]?enforcement|planEnforcement|cloud_tenants|cloud_billing)\b/i
  },
  {
    name: "SaaS abuse or production rate-limit implementation belongs in cloud wrappers",
    pattern: /\b(abuse|rate[-_ ]?limit|usage[_-]?meter|usageMeter)\b/i
  }
];

const findings = [];
auditWorkspaceBoundary();
walk(root);

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.name}`);
  }
  process.exit(1);
}

console.log("public boundary audit ok");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name) || relative.split(path.sep).some((part) => ignoredDirs.has(part))) continue;
      walk(absolute);
      continue;
    }
    if (!entry.isFile() || ignoredFiles.has(entry.name) || isBinaryLike(entry.name)) continue;
    scanFile(absolute, relative);
  }
}

function scanFile(absolute, relative) {
  const content = fs.readFileSync(absolute, "utf8");
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const check of denied) {
      if (check.pattern.test(line)) {
        findings.push({ file: relative, line: index + 1, name: check.name });
      }
    }
    if (isPublicRuntimeFile(relative)) {
      for (const check of deniedPublicRuntime) {
        if (check.pattern.test(line)) {
          findings.push({ file: relative, line: index + 1, name: check.name });
        }
      }
    }
    if (isPublicApiImplementationFile(relative)) {
      for (const check of deniedPublicApiImplementation) {
        if (check.pattern.test(line)) {
          findings.push({ file: relative, line: index + 1, name: check.name });
        }
      }
    }
  }
}

function isBinaryLike(file) {
  return /\.(png|jpg|jpeg|webp|gif|ico|icns|pdf|zip|gz|tgz|sqlite|db)$/i.test(file);
}

function auditWorkspaceBoundary() {
  const rootPackage = readJson("package.json");
  const workspaces = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
  for (const privateWorkspace of privateCloudWorkspaces) {
    if (workspaces.includes(privateWorkspace)) {
      findings.push({
        file: "package.json",
        line: lineFor("package.json", privateWorkspace),
        name: `${privateWorkspace} must stay outside the public npm workspaces`
      });
    }
  }

  for (const workspace of publicWorkspaces) {
    const packageFile = path.join(workspace, "package.json");
    if (!fs.existsSync(path.join(root, packageFile))) continue;
    const pkg = readJson(packageFile);
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const deps = pkg[section] && typeof pkg[section] === "object" ? Object.keys(pkg[section]) : [];
      for (const dep of deps) {
        if (dep.startsWith("@openleash-private/") || ["@openleash-private/cloud-client-api", "@openleash-private/cloud-dashboard-api", "@openleash-private/cloud-dashboard-web"].includes(dep)) {
          findings.push({
            file: packageFile,
            line: lineFor(packageFile, dep),
            name: "public workspace depends on private cloud package"
          });
        }
      }
    }
  }

  for (const workspace of privateCloudWorkspaces) {
    const packageFile = path.join(workspace, "package.json");
    if (!fs.existsSync(path.join(root, packageFile))) continue;
    const pkg = readJson(packageFile);
    if (!pkg.private || !String(pkg.name ?? "").startsWith("@openleash-private/")) {
      findings.push({
        file: packageFile,
        line: 1,
        name: "cloud wrapper package must be private and named @openleash-private/*"
      });
    }
  }
}

function isPublicRuntimeFile(relative) {
  return publicRuntimeDirs.some((dir) => relative === dir || relative.startsWith(`${dir}/`))
    && /\.(mjs|cjs|js|jsx|ts|tsx|dart)$/.test(relative)
    && !relative.includes("/README.");
}

function isPublicApiImplementationFile(relative) {
  return (relative.startsWith("apps/client-api/src/") || relative.startsWith("apps/dashboard-api/src/"))
    && /\.(mjs|cjs|js|jsx|ts|tsx)$/.test(relative)
    && !relative.endsWith("/README.md")
    && !relative.endsWith("/product-mode.ts");
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function lineFor(relative, needle) {
  const lines = fs.readFileSync(path.join(root, relative), "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(needle));
  return index >= 0 ? index + 1 : 1;
}
