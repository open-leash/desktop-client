# Deterministic production releases

`release.py --production` is the canonical non-LLM release conductor. It owns
the complete path from selected source repositories to published containers,
desktop downloads, cloud deployments, and the live website installer.

## Select the release

Every component is explicit and independently versioned:

```bash
# Plan only; makes no local or remote changes.
python3 release.py --production \
  --app client-api=0.37.4 \
  --app cloud-client-api=0.1.16 \
  --dry-run --yes

# Execute exactly that plan.
python3 release.py --production \
  --app client-api=0.37.4 \
  --app cloud-client-api=0.1.16 \
  --ship --yes
```

Production versions are stable `x.y.z` semantic versions. Prerelease/build
suffixes are rejected so numeric ordering and immutable tags stay unambiguous.

Supported component names are `shared`, `client-api`, `local-proxy`,
`cloud-client-api`, `desktop-client`, and `main-web`. Prefixes such as
`apps/desktop-client` are accepted.

Product dependencies are automatic where a release would otherwise strand a
user on stale binaries:

- `client-api` adds `desktop-client` and `main-web`, because the Personal Open
  Source installer and desktop-embedded Compose definition must receive the new
  immutable image digest.
- `local-proxy` adds `desktop-client` and `main-web`, because the proxy image is
  compiled into the desktop client.
- `desktop-client` adds `main-web`, because `install.sh` and the signed-in
  download surface must point to the published desktop release.
- `cloud-client-api` remains explicit. Private Cloud changes are never inferred
  from a public release selection.

Omit `=VERSION` to select the next patch version. Always run `--dry-run` first.

## Fixed release order

The production pipeline executes this graph in order:

1. Check required tools, GitHub authentication, `main` branches, remote
   synchronization, immutable version tags, and clean dependency checkouts.
2. Enforce the public product/user-flow contract.
3. Release shared contracts when selected.
4. Test and publish the public `client-api` multi-architecture container.
5. Resolve its anonymous GHCR digest, pin that exact `version@digest` in the
   public installer, Personal Open Source Compose file, and desktop source, then
   commit the public pin files without staging unrelated root changes.
6. Pull the published image and run a real clean Personal Open Source database
   migration twice, bootstrap, eight-Feature registry check, API startup, and
   health check.
7. Test/publish `local-proxy` when selected and pin its immutable digest into
   desktop source.
8. For `cloud-client-api`, pin exact public dependency commits, test core and
   cloud migrations, back up production, apply core then cloud migrations,
   deploy, re-check migration status, and require `/cloud/health` to report the
   exact newly released package version (a healthy older revision fails).
9. Build and test desktop, including native ABI, packaged shared runtime,
   clean-install, running/read-only upgrade, stale launch-job, and atomic install
   gates. The GitHub macOS/Windows workflows remain the artifact authority.
10. Deploy `main-web`, wait for its production check, fetch the live
    `https://openleash.com/install.sh`, and make it download and checksum the
    exact published installer and DMG.

No stage is marked complete until its command succeeds. State is written
atomically under `~/.openleash-release/` and contains the original commits,
selected versions, published digests, release URLs, completed stages, and live
verification results.

## Migrations

Database migrations are append-only. The release preflight refuses changes,
renames, or deletion of a migration already present on `origin/main`. A schema
change must arrive as a new numbered migration; release automation never
generates a migration by copying the entire current schema.

The public `client-api` gate runs representative old Postgres fixtures and
applies every migration twice. The cloud gate creates a clean database, applies
both core and hosted migrations twice, and verifies the core/cloud ledgers and
required hosted tables. Both gates use short-lived, uniquely named Postgres
containers with ephemeral storage and random host ports; they never reuse or
stop the developer's local Leash database.

Before a live `cloud-client-api` push, production follows this exact order:

```text
read-only status → schema backup → core migrations → cloud migrations
→ source push/deploy → read-only status → live health
```

Configure one of `OPENLEASH_GCP_DATABASE_URL`,
`OPENLEASH_CLOUD_SQL_DATABASE_URL`, `CLOUD_SQL_DATABASE_URL`, or
`GCP_DATABASE_URL`. An explicit URL is also supported:

```bash
python3 release.py --production \
  --app cloud-client-api=0.1.16 \
  --migration-target custom \
  --database-url 'postgres://…' \
  --ship --yes
```

`--cloud-source-only` intentionally stops at source publication and skips
production migrations/deployment. It is not a production cloud release.

## Desktop channels

The current default is `--desktop-channel terminal`. It builds a locally signed
macOS DMG, runs the real installer gate on a clean macOS runner, publishes the
stable Terminal asset names and checksums, and makes `install.sh` the supported
installation path without requiring Apple credentials. It updates only the Mac
download; the website keeps the last verified Windows artifact until a stable
signed Windows release is selected.

`--desktop-channel stable` requires configured Apple signing/notarization
secrets. It waits for both native macOS and Windows workflows, verifies every
required asset, and publishes the verified desktop update feed using
`OPENLEASH_RELEASE_ADMIN_TOKEN`.

## Resume and failure behavior

If a network, CI, migration, artifact, or deployment stage fails, fix the cause
and resume the recorded state:

```bash
python3 release.py --production \
  --resume ~/.openleash-release/production-20260817-120000Z.json \
  --ship --yes
```

Successful stages are not repeated. Failed stages are never recorded as
complete. Immutable tags and digests are checked before reuse, so a resume
cannot silently replace already published bytes. The journal also preserves the
original release channel, rollout, URLs, migration target, and source-only
choice. Database credentials are deliberately not written to disk; pass
`--database-url` again when resuming a custom migration target.

There are deliberately no production flags to skip tests, builds, migrations,
artifact verification, or live verification. Use the older preparatory mode
without `--production` only for local development; it is not a completed
production release.
