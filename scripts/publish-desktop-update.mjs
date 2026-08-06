#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const version = valueAfter("--version") ?? JSON.parse(fs.readFileSync("apps/desktop-client/package.json", "utf8")).version;
const apiBase = (valueAfter("--api") ?? process.env.OPENLEASH_RELEASE_API_URL ?? "https://api.openleash.com").replace(/\/$/, "");
const rolloutPercent = Number(valueAfter("--rollout") ?? 100);
const dryRun = process.argv.includes("--dry-run");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("desktop version must be stable semver");
if (!Number.isInteger(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) throw new Error("--rollout must be 0-100");

const releaseResponse = await fetch(`https://api.github.com/repos/open-leash/desktop-client/releases/tags/v${version}`, {
  headers: { accept: "application/vnd.github+json", "user-agent": "openleash-release" },
});
if (!releaseResponse.ok) throw new Error(`GitHub release lookup returned ${releaseResponse.status}`);
const release = await releaseResponse.json();
if (release.tag_name !== `v${version}` || release.draft || release.prerelease) throw new Error("release is not a published stable tag");
const asset = (name) => release.assets.find((candidate) => candidate.name === name);
const dmgName = `Leash-${version}-arm64.dmg`;
const windowsName = `Leash-${version}-x64-Setup.exe`;
const dmg = asset(dmgName);
const windowsInstaller = asset(windowsName);
const checksums = asset("SHA256SUMS");
const windowsChecksums = asset("SHA256SUMS-WINDOWS");
const installer = asset("install-openleash-personal.sh");
if (!dmg || !checksums || !installer) {
  throw new Error("release must contain the macOS installer, checksum manifest, and helper");
}
if (Boolean(windowsInstaller) !== Boolean(windowsChecksums)) {
  throw new Error("a Windows installer and SHA256SUMS-WINDOWS must be published together");
}

const checksumText = await downloadText(checksums.browser_download_url);
const verifiedMac = await verifyAsset(dmg, dmgName, checksumText);

const payloads = [
  releasePayload("darwin", "arm64", dmg.browser_download_url, verifiedMac),
];
if (windowsInstaller && windowsChecksums) {
  const windowsChecksumText = await downloadText(windowsChecksums.browser_download_url);
  const verifiedWindows = await verifyAsset(windowsInstaller, windowsName, windowsChecksumText);
  payloads.push(releasePayload("win32", "x64", windowsInstaller.browser_download_url, verifiedWindows));
}
if (dryRun) {
  console.log(JSON.stringify(payloads, null, 2));
  process.exit(0);
}

const token = process.env.OPENLEASH_RELEASE_ADMIN_TOKEN;
if (!token) throw new Error("OPENLEASH_RELEASE_ADMIN_TOKEN is required");
for (const payload of payloads) {
  const publishResponse = await fetch(`${apiBase}/api/admin/releases`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!publishResponse.ok) throw new Error(`release feed publish returned ${publishResponse.status}: ${await publishResponse.text()}`);
  const checkResponse = await fetch(`${apiBase}/api/updates/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app: payload.app, version: "0.0.0", platform: payload.platform, arch: payload.arch, channel: payload.channel, installMode: "release-verification", updateSource: "release-verification" }),
  });
  const check = await checkResponse.json();
  if (!checkResponse.ok || check.latestVersion !== version || check.sha256 !== payload.sha256) {
    throw new Error(`published ${payload.platform}/${payload.arch} update feed did not return the verified release`);
  }
}
console.log(JSON.stringify({ ok: true, version, platforms: payloads.map(({ platform, arch, sha256 }) => ({ platform, arch, sha256 })), rolloutPercent }, null, 2));

function releasePayload(platform, arch, downloadUrl, verified) {
  return {
    app: "openleash-personal",
    version,
    channel: "stable",
    platform,
    arch,
    dmgUrl: downloadUrl,
    sha256: verified.sha256,
    sizeBytes: verified.sizeBytes,
    notesUrl: release.html_url,
    releaseNotes: String(release.body ?? "").trim(),
    rolloutPercent,
    active: true,
    publishedAt: release.published_at,
  };
}

async function verifyAsset(releaseAsset, filename, checksumText) {
  const expected = checksumFor(checksumText, filename);
  const bytes = Buffer.from(await download(releaseAsset.browser_download_url));
  const actual = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`published ${filename} checksum mismatch: expected ${expected}, received ${actual}`);
  if (Number(releaseAsset.size) !== bytes.length) throw new Error(`published ${filename} size mismatch: expected ${releaseAsset.size}, received ${bytes.length}`);
  return { sha256: actual, sizeBytes: bytes.length };
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download returned ${response.status}: ${url}`);
  return response.arrayBuffer();
}

async function downloadText(url) {
  return Buffer.from(await download(url)).toString("utf8");
}

function checksumFor(text, filename) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match?.[2] === filename) return match[1];
  }
  throw new Error(`SHA256SUMS is missing ${filename}`);
}
