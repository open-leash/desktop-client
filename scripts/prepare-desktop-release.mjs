#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const rootPackagePath = path.join(root, "package.json");
const desktopPackagePath = path.join(root, "apps/desktop/package.json");
const mainWebSitePath = path.join(root, "apps/main-web/components/redesign/site.jsx");
const accountClientPath = path.join(root, "apps/main-web/app/account/AccountClient.tsx");
const mainWebDockerfilePath = path.join(root, "apps/main-web/Dockerfile");
const mainWebInstallScriptPath = path.join(root, "apps/main-web/public/install.sh");

const args = new Set(process.argv.slice(2));
const explicitVersion = valueAfter("--version");
const dryRun = args.has("--dry-run");
const linksOnly = args.has("--links-only");
const includeWindows = args.has("--include-windows");
const terminalInstaller = args.has("--terminal-installer");
const shouldBumpMinor = args.has("--bump-minor") || (!explicitVersion && !args.has("--current"));
const downloadHost = (valueAfter("--download-host") ?? process.env.OPENLEASH_DESKTOP_DOWNLOAD_HOST ?? "github").toLowerCase();

if (!["github", "gcs"].includes(downloadHost)) {
  throw new Error(`Unsupported --download-host ${downloadHost}. Use github or gcs.`);
}

const desktopPackage = readJson(desktopPackagePath);
const currentVersion = desktopPackage.version;
const nextVersion = explicitVersion ?? (shouldBumpMinor ? bumpMinor(currentVersion) : currentVersion);
const shortVersion = shortSemver(nextVersion);

if (!dryRun) {
  if (!linksOnly) {
    for (const packagePath of [rootPackagePath, desktopPackagePath]) {
      const pkg = readJson(packagePath);
      pkg.version = nextVersion;
      writeJson(packagePath, pkg);
    }
  }

  rewriteMainWebDownloads(nextVersion, shortVersion);

  if (!linksOnly) {
    run("npm", ["install", "--package-lock-only"]);
  }
}

console.log(`${dryRun ? "Would prepare" : "Prepared"} Leash desktop release ${nextVersion}.`);
if (linksOnly) {
  console.log("Mode: links only");
}
console.log(`Website download label: v${shortVersion}`);
console.log(`Download host: ${downloadHost}`);
console.log(`Mac asset: ${terminalInstaller ? `Leash-${nextVersion}-terminal-installer-arm64.dmg` : `Leash-${nextVersion}-arm64.dmg`}`);
console.log(`Windows asset: ${includeWindows ? `Leash-${nextVersion}-x64-Setup.exe` : "gated until --include-windows and signing credentials are available"}`);

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function bumpMinor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version);
  if (!match) {
    throw new Error(`Cannot bump non-semver version: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]) + 1;
  return `${major}.${minor}.0`;
}

function shortSemver(version) {
  const match = /^(\d+\.\d+)\.\d+(?:-.+)?$/.exec(version);
  return match ? match[1] : version;
}

function rewriteMainWebDownloads(version, label) {
  const { macUrl, windowsUrl } = desktopDownloadUrls(version);

  replaceInFile(mainWebSitePath, [
    [/Download for Mac <small>v[^<]+<\/small>/, `Download for Mac <small>v${label}</small>`],
    [/Download for Windows <small>v[^<]+<\/small>/, `Download for Windows <small>v${label}</small>`],
    [/const WINDOWS_DOWNLOAD_URL = .*?;\n/, `const WINDOWS_DOWNLOAD_URL = process.env.NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL || "${windowsUrl}";\n`]
  ]);

  replaceInFile(accountClientPath, [
    [/const macInstallCommand = "curl -fsSL https:\/\/openleash\.com\/install\.sh \| sh";/, 'const macInstallCommand = "curl -fsSL https://openleash.com/install.sh | sh";']
  ]);

  if (includeWindows) {
    replaceInFile(accountClientPath, [
      [/const windowsDownloadUrl = .*?;\n/, `const windowsDownloadUrl = process.env.NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL ?? "${windowsUrl}";\n`]
    ]);
  }

  replaceOptionalInFile(accountClientPath, [
    [/Mac v\d+\.\d+/g, `Mac v${label}`]
  ]);

  replaceInFile(mainWebDockerfilePath, [
    [/ARG NEXT_PUBLIC_MAC_DOWNLOAD_URL=.*$/m, `ARG NEXT_PUBLIC_MAC_DOWNLOAD_URL=${macUrl}`]
  ]);

  if (includeWindows) {
    replaceInFile(mainWebDockerfilePath, [
      [/ARG NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL=.*$/m, `ARG NEXT_PUBLIC_WINDOWS_DOWNLOAD_URL=${windowsUrl}`]
    ]);
  }

  replaceInFile(mainWebInstallScriptPath, [
    [/OPENLEASH_DESKTOP_VERSION="\$\{OPENLEASH_DESKTOP_VERSION:-[^}]+\}"/, `OPENLEASH_DESKTOP_VERSION="\${OPENLEASH_DESKTOP_VERSION:-${version}}"`]
  ]);

}

function desktopDownloadUrls(version) {
  if (downloadHost === "gcs") {
    const bucket = process.env.OPENLEASH_DESKTOP_GCS_BUCKET ?? "openleash-downloads-cloud-497307";
    const baseUrl = `https://storage.googleapis.com/${bucket}/desktop/${version}`;
    return {
      macUrl: terminalInstaller
        ? `${baseUrl}/Leash-${version}-terminal-installer-arm64.dmg`
        : `${baseUrl}/Leash-${version}-arm64.dmg`,
      windowsUrl: `${baseUrl}/Leash-${version}-x64-Setup.exe`
    };
  }

  const repo = process.env.OPENLEASH_DESKTOP_GITHUB_REPO ?? "open-leash/leash";
  const baseUrl = `https://github.com/${repo}/releases/download/v${version}`;
  return {
    macUrl: terminalInstaller
      ? `${baseUrl}/Leash-${version}-terminal-installer-arm64.dmg`
      : `${baseUrl}/Leash-${version}-arm64.dmg`,
    windowsUrl: `${baseUrl}/Leash-${version}-x64-Setup.exe`
  };
}

function replaceInFile(filePath, replacements) {
  let source = fs.readFileSync(filePath, "utf8");
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(source)) {
      throw new Error(`Pattern ${pattern} not found in ${filePath}`);
    }
    source = source.replace(pattern, replacement);
  }
  fs.writeFileSync(filePath, source);
}

function replaceOptionalInFile(filePath, replacements) {
  let source = fs.readFileSync(filePath, "utf8");
  for (const [pattern, replacement] of replacements) {
    source = source.replace(pattern, replacement);
  }
  fs.writeFileSync(filePath, source);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}
