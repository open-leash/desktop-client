import type { Request } from "express";
import { Pool } from "pg";
import { z } from "zod";

export type ClientUpdateRequest = {
  app: string;
  version: string;
  platform: string;
  arch: string;
  channel: string;
  installMode: string;
  updateSource: string;
};

export type ClientUpdateResponse = {
  updateAvailable: boolean;
  latestVersion: string;
  currentVersion: string;
  channel: string;
  platform: string;
  arch: string;
  downloadUrl?: string;
  dmgUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  notesUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
  minSupportedVersion?: string;
  rollout?: {
    eligible: boolean;
    percent: number;
  };
};

export const updateRequestSchema = z.object({
  app: z.string().default("openleash-personal"),
  version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  channel: z.string().default("stable"),
  installMode: z.string().default("personal"),
  updateSource: z.string().default("public")
});

type ReleaseRow = {
  version: string;
  channel: string;
  platform: string;
  arch: string;
  dmg_url: string;
  sha256: string | null;
  size_bytes: number | null;
  notes_url: string | null;
  release_notes: string | null;
  min_supported_version: string | null;
  rollout_percent: number;
  published_at: string;
};

type GithubReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
  size?: unknown;
};

type GithubRelease = {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  assets?: unknown;
};

const defaultGithubReleaseRepository = "open-leash/leash";
const defaultGithubReleaseCacheMs = 5 * 60 * 1000;
let githubReleaseCache:
  | { expiresAt: number; release: GithubRelease }
  | undefined;
let githubReleaseRequest: Promise<GithubRelease> | undefined;

let pool: Pool | undefined;
let migrated = false;
let migrationPromise: Promise<void> | undefined;

export function releaseDb() {
  const connectionString = process.env.OPENLEASH_RELEASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  pool ??= new Pool({ connectionString });
  return pool;
}

export async function ensureReleaseSchema() {
  const database = releaseDb();
  if (!database || migrated) return;
  if (migrationPromise) return migrationPromise;
  migrationPromise = migrateSchema(database).finally(() => {
    migrationPromise = undefined;
  });
  return migrationPromise;
}

async function migrateSchema(database: Pool) {
  await database.query(`create extension if not exists pgcrypto`);
  await database.query(`
    create table if not exists client_releases (
      id uuid primary key default gen_random_uuid(),
      app text not null default 'openleash-personal',
      version text not null,
      channel text not null default 'stable',
      platform text not null,
      arch text not null,
      dmg_url text not null,
      sha256 text,
      size_bytes bigint,
      notes_url text,
      release_notes text,
      min_supported_version text,
      rollout_percent integer not null default 100 check (rollout_percent >= 0 and rollout_percent <= 100),
      active boolean not null default true,
      published_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(app, version, channel, platform, arch)
    )
  `);
  await database.query(`
    create table if not exists client_update_checks (
      id uuid primary key default gen_random_uuid(),
      app text not null,
      current_version text not null,
      latest_version text,
      platform text not null,
      arch text not null,
      channel text not null,
      install_mode text not null,
      update_source text not null,
      update_available boolean not null default false,
      checked_at timestamptz not null default now()
    )
  `);
  migrated = true;
}

export async function checkForClientUpdate(request: ClientUpdateRequest): Promise<ClientUpdateResponse> {
  if (!clientUpdatesEnabled()) {
    return {
      updateAvailable: false,
      latestVersion: request.version,
      currentVersion: request.version,
      channel: request.channel,
      platform: request.platform,
      arch: request.arch,
    };
  }
  await ensureReleaseSchema();
  const release = await latestRelease(request);
  const currentVersion = request.version;
  const latestVersion = release?.version ?? currentVersion;
  const updateAvailable = release ? compareVersions(release.version, currentVersion) > 0 : false;
  await recordCheck(request, release, updateAvailable);
  return {
    updateAvailable,
    latestVersion,
    currentVersion,
    channel: request.channel,
    platform: request.platform,
    arch: request.arch,
    ...(release ? {
      downloadUrl: release.dmg_url,
      dmgUrl: release.dmg_url,
      sha256: release.sha256 ?? undefined,
      sizeBytes: release.size_bytes ? Number(release.size_bytes) : undefined,
      notesUrl: release.notes_url ?? undefined,
      releaseNotes: release.release_notes ?? undefined,
      publishedAt: release.published_at,
      minSupportedVersion: release.min_supported_version ?? undefined,
      rollout: {
        eligible: release.rollout_percent > 0,
        percent: release.rollout_percent
      }
    } : {})
  };
}

export function clientUpdatesEnabled(
  value = process.env.OPENLEASH_CLIENT_UPDATES_ENABLED,
) {
  return !["0", "false", "off"].includes(String(value ?? "true").toLowerCase());
}

async function latestRelease(request: ClientUpdateRequest) {
  const githubRelease = await latestGithubRelease(request).catch((error) => {
    console.warn(
      `Could not read the latest Leash desktop release from GitHub: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return undefined;
  });
  if (githubRelease) return githubRelease;

  const database = releaseDb();
  if (!database) return envRelease(request);
  const result = await database.query<ReleaseRow>(
    `select version, channel, platform, arch, dmg_url, sha256, size_bytes, notes_url, release_notes,
            min_supported_version, rollout_percent, published_at::text
       from client_releases
      where app = $1
        and channel = $2
        and platform = $3
        and arch = $4
        and active = true
      order by published_at desc, created_at desc
      limit 1`,
    [request.app, request.channel, request.platform, request.arch]
  );
  return result.rows[0] ?? envRelease(request);
}

async function latestGithubRelease(
  request: ClientUpdateRequest,
): Promise<ReleaseRow | undefined> {
  if (!githubReleaseUpdatesEnabled()) return undefined;
  if (request.app !== "openleash-personal" || request.channel !== "stable")
    return undefined;

  const release = await fetchLatestGithubRelease();
  if (release.draft === true || release.prerelease === true) return undefined;
  const version = String(release.tag_name ?? "").replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) return undefined;

  const filename = releaseAssetName(version, request.platform, request.arch);
  if (!filename) return undefined;
  const assets = Array.isArray(release.assets)
    ? (release.assets as GithubReleaseAsset[])
    : [];
  const verificationAsset = releaseVerificationAssetName(
    request.platform,
    request.arch,
  );
  if (
    !verificationAsset ||
    !assets.some((asset) => asset.name === verificationAsset)
  )
    return undefined;
  const installer = assets.find((asset) => asset.name === filename);
  const downloadUrl = String(installer?.browser_download_url ?? "");
  const sizeBytes = Number(installer?.size);
  if (
    !installer ||
    !downloadUrl ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0
  )
    return undefined;

  const sha256 = await githubAssetSha256(
    installer,
    assets,
    filename,
    request.platform,
  );
  if (!sha256) return undefined;

  return {
    version,
    channel: request.channel,
    platform: request.platform,
    arch: request.arch,
    dmg_url: downloadUrl,
    sha256,
    size_bytes: sizeBytes,
    notes_url: String(release.html_url ?? "") || null,
    release_notes: String(release.body ?? "").trim() || null,
    min_supported_version: null,
    rollout_percent: 100,
    published_at:
      String(release.published_at ?? "") || new Date().toISOString(),
  };
}

function githubReleaseUpdatesEnabled(
  value = process.env.OPENLEASH_GITHUB_RELEASE_UPDATES,
) {
  return !["0", "false", "off"].includes(
    String(value ?? "true").toLowerCase(),
  );
}

async function fetchLatestGithubRelease(): Promise<GithubRelease> {
  const now = Date.now();
  if (githubReleaseCache && githubReleaseCache.expiresAt > now)
    return githubReleaseCache.release;
  if (githubReleaseRequest) return githubReleaseRequest;

  const repository =
    process.env.OPENLEASH_DESKTOP_RELEASE_REPOSITORY ??
    defaultGithubReleaseRepository;
  githubReleaseRequest = fetch(
    `https://api.github.com/repos/${repository}/releases/latest`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Leash-update-service",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(5_000),
    },
  )
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`GitHub returned ${response.status}`);
      const release = (await response.json()) as GithubRelease;
      const cacheMs = Number(
        process.env.OPENLEASH_GITHUB_RELEASE_CACHE_MS ??
          defaultGithubReleaseCacheMs,
      );
      githubReleaseCache = {
        expiresAt: Date.now() +
          (Number.isFinite(cacheMs) && cacheMs >= 0
            ? cacheMs
            : defaultGithubReleaseCacheMs),
        release,
      };
      return release;
    })
    .finally(() => {
      githubReleaseRequest = undefined;
    });
  return githubReleaseRequest;
}

function releaseAssetName(version: string, platform: string, arch: string) {
  if (platform === "darwin" && arch === "arm64")
    return `Leash-${version}-arm64.dmg`;
  if (platform === "win32" && arch === "x64")
    return `Leash-${version}-x64-Setup.exe`;
  return undefined;
}

function releaseVerificationAssetName(platform: string, arch: string) {
  if (platform === "darwin" && arch === "arm64")
    return "MACOS-NOTARIZATION-VERIFIED";
  if (platform === "win32" && arch === "x64")
    return "WINDOWS-SIGNATURE-VERIFIED";
  return undefined;
}

async function githubAssetSha256(
  installer: GithubReleaseAsset,
  assets: GithubReleaseAsset[],
  filename: string,
  platform: string,
) {
  const digest = String(installer.digest ?? "");
  const digestMatch = /^sha256:([a-f0-9]{64})$/i.exec(digest);
  if (digestMatch) return digestMatch[1].toLowerCase();

  const checksumName =
    platform === "win32" ? "SHA256SUMS-WINDOWS" : "SHA256SUMS";
  const checksumAsset = assets.find((asset) => asset.name === checksumName);
  const checksumUrl = String(checksumAsset?.browser_download_url ?? "");
  if (!checksumUrl) return undefined;
  const response = await fetch(checksumUrl, {
    headers: { "user-agent": "Leash-update-service" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return undefined;
  for (const line of (await response.text()).split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match?.[2] === filename) return match[1].toLowerCase();
  }
  return undefined;
}

export function resetGithubReleaseCacheForTests() {
  githubReleaseCache = undefined;
  githubReleaseRequest = undefined;
}

function envRelease(request: ClientUpdateRequest): ReleaseRow | undefined {
  const version = process.env.OPENLEASH_LATEST_VERSION;
  const dmgUrl = process.env.OPENLEASH_LATEST_DMG_URL;
  if (!version || !dmgUrl) return undefined;
  return {
    version,
    channel: request.channel,
    platform: request.platform,
    arch: request.arch,
    dmg_url: dmgUrl,
    sha256: process.env.OPENLEASH_LATEST_SHA256 ?? null,
    size_bytes: process.env.OPENLEASH_LATEST_SIZE_BYTES ? Number(process.env.OPENLEASH_LATEST_SIZE_BYTES) : null,
    notes_url: process.env.OPENLEASH_LATEST_NOTES_URL ?? null,
    release_notes: process.env.OPENLEASH_LATEST_NOTES ?? null,
    min_supported_version: process.env.OPENLEASH_MIN_SUPPORTED_VERSION ?? null,
    rollout_percent: Number(process.env.OPENLEASH_ROLLOUT_PERCENT ?? 100),
    published_at: new Date().toISOString()
  };
}

async function recordCheck(request: ClientUpdateRequest, release: ReleaseRow | undefined, updateAvailable: boolean) {
  const database = releaseDb();
  if (!database) return;
  await database.query(
    `insert into client_update_checks
      (app, current_version, latest_version, platform, arch, channel, install_mode, update_source, update_available)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [request.app, request.version, release?.version ?? null, request.platform, request.arch, request.channel, request.installMode, request.updateSource, updateAvailable]
  );
}

export async function upsertRelease(input: unknown) {
  const adminToken = process.env.OPENLEASH_RELEASE_ADMIN_TOKEN;
  if (!adminToken) throw new Error("OPENLEASH_RELEASE_ADMIN_TOKEN is not configured.");
  const body = releaseSchema.parse(input);
  await ensureReleaseSchema();
  const database = releaseDb();
  if (!database) throw new Error("OPENLEASH_RELEASE_DATABASE_URL or DATABASE_URL is required.");
  await database.query(
    `insert into client_releases
      (app, version, channel, platform, arch, dmg_url, sha256, size_bytes, notes_url, release_notes, min_supported_version, rollout_percent, active, published_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, coalesce($14::timestamptz, now()), now())
     on conflict(app, version, channel, platform, arch) do update set
       dmg_url = excluded.dmg_url,
       sha256 = excluded.sha256,
       size_bytes = excluded.size_bytes,
       notes_url = excluded.notes_url,
       release_notes = excluded.release_notes,
       min_supported_version = excluded.min_supported_version,
       rollout_percent = excluded.rollout_percent,
       active = excluded.active,
       published_at = excluded.published_at,
       updated_at = now()`,
    [
      body.app,
      body.version,
      body.channel,
      body.platform,
      body.arch,
      body.dmgUrl,
      body.sha256 ?? null,
      body.sizeBytes ?? null,
      body.notesUrl ?? null,
      body.releaseNotes ?? null,
      body.minSupportedVersion ?? null,
      body.rolloutPercent,
      body.active,
      body.publishedAt ?? null
    ]
  );
  return body;
}

const releaseSchema = z.object({
  app: z.string().default("openleash-personal"),
  version: z.string().min(1),
  channel: z.string().default("stable"),
  platform: z.string().default("darwin"),
  arch: z.string().default("arm64"),
  dmgUrl: z.string().url(),
  sha256: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  notesUrl: z.string().url().optional(),
  releaseNotes: z.string().optional(),
  minSupportedVersion: z.string().optional(),
  rolloutPercent: z.number().int().min(0).max(100).default(100),
  active: z.boolean().default(true),
  publishedAt: z.string().optional()
});

export function assertReleaseAdmin(request: Request) {
  const expected = process.env.OPENLEASH_RELEASE_ADMIN_TOKEN;
  if (!expected) throw new Error("OPENLEASH_RELEASE_ADMIN_TOKEN is not configured.");
  const actual = request.header("authorization")?.replace(/^Bearer\s+/i, "");
  return actual === expected;
}

export function compareVersions(left: string, right: string) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function versionParts(value: string) {
  return value
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}
