# OpenLeash Release System

This document defines the intended OpenLeash release workflow. It is designed to let development remain conversational and fast while making customer updates repeatable, compatible, recoverable, and progressively deployed.

`docs/Product.md` remains the source of truth for product modes and release expectations. If this document conflicts with it, update this document.

## Current Production Release

Desktop `0.36.13` fixes repeated sensitive-access approval notifications at both
layers that can produce them. The desktop island presents a pending approval
automatically only once, while `client-api` reuses one explicit approval when
Claude reports the same credential intent through the API hook, local proxy, and
later tool-use event. A proxy observation without a project path may reuse the
matching hook approval, but two known, different projects remain isolated. An
implicit prompt allow is never reusable for a later sensitive tool operation.

OpenLeash Cloud runs the fix from public `client-api` commit
`8d7ed08933e9167665c4ffa060c00ca843f07f63`. Individual Open Source and Private
Cloud installs use the public multi-architecture image
`ghcr.io/open-leash/client-api:0.36.21@sha256:19c14057ce67c558fcdeb6dfcea5e3d05d480c293483e672246d95e68e26a76a`.
The image passed the release vulnerability gate with no high or critical
findings and was verified anonymously pullable. The macOS desktop artifact is
`OpenLeash-0.36.13-arm64.dmg` with SHA-256
`9b1febfa0fb7e094ac18da78cbc0f41f7480ff7a5dd3a02f9a049f473f603bf5`.

## The Developer Experience

The normal development workflow should not require manually choosing or editing version numbers.

During development, the developer can ask for an installable artifact:

> Finish this and give me a DMG/Docker image.

This creates development artifacts with generated prerelease identities, for example:

```text
desktop-client  0.37.0-dev.20260714.4+abc123
client-api      0.42.0-dev.20260714.4+abc123
dashboard-web   0.31.0-dev.20260714.4+abc123
```

Development artifacts may be uploaded to an internal channel, but they must not change public update feeds or become customer releases.

When the work is ready, the developer can ask:

> Release everything that changed.

Release automation detects affected components, assigns versions, validates migrations and compatibility, builds immutable artifacts, and publishes a canary release. Version selection and migration safety are release-system responsibilities, not manual developer chores.

## What A Release Means

A release is an immutable, tested set of compatible artifacts. It is not merely a build upload, Git tag, Docker push, or version bump.

Each release has one release ID and a generated manifest:

```text
OpenLeash Release 2026.07.14.1

desktop-client:       0.37.0
client-api:           0.42.0
dashboard-api:        0.28.0
dashboard-web:        0.31.0
local-proxy:          0.20.0
Postgres schema:      34
desktop cache schema: 7
API contract range:   2026-05-16 through 2026-07-14
```

Not every component needs to change in every release. The manifest records the exact compatible versions even when some artifacts are unchanged.

Released artifacts are immutable:

- A Git tag always points to one commit.
- Docker images are recorded and deployed by digest, not only by a mutable tag such as `latest`.
- Signed desktop installers include checksums and are never replaced under an existing version.
- Applied migration files are never edited; corrections are new forward migrations.
- Release manifests, checksums, release notes, and rollback information are retained permanently.
- Container-plugin images are signed and recorded by digest. A marketplace version cannot be approved or promoted with a mutable tag alone.

## Container Plugin Releases

Container plugins use the versioned `openleash-container-plugin.v1` protocol. A plugin release records its image tag, immutable digest, placement, resource limits, storage contract, health/transform/tool paths, timeout, failure behavior, and minimum compatible client/API contract.

Settings do not define deployment units. The runtime keeps one container or warm worker pool per plugin version and sends the resolved organization/user/agent profile on each signed request, including profile IDs and a deterministic configuration hash. Environment variables are reserved for host/runtime wiring and secrets, not tenant or agent settings. Release tests must prove that different profiles are isolated across consecutive requests to the same container and that a disabled profile is honored without restarting it.

Desktop rollout reconciles account desired state without making the proxy plugin-aware:

1. Pull the new image by digest while the prior container remains active.
2. Start it with a read-only root filesystem, dropped capabilities, bounded CPU/memory/PIDs, plugin-scoped storage, and a fresh runtime secret. Plugins without reviewed network permission use `--network none`; the edge tunnels signed HTTP to container loopback with `docker exec`.
3. Require protocol, plugin ID, version, and health readiness to match the manifest.
4. Stop and rename the old container only after candidate readiness, then start the new container under the stable name.
5. Restore the retained old container automatically if the final start or readiness check fails.
6. Remove it only after health and outcome telemetry remain within promotion thresholds.

Cloud rollout starts a warm pool for the new plugin version, loads models, passes readiness and protocol tests, shifts canary traffic, drains the old pool, and keeps it available for rollback. Popular/model-heavy plugins never scale synchronously from zero on a live prompt. Shared trusted pools are keyed by plugin ID + version + region + isolation class, not by customer. Tenant-dedicated pools are an explicit security/deployment tier.

Mandatory release gates for container plugins include:

- multi-architecture image build where the desktop platforms require it;
- signature, digest, SBOM, dependency/license, vulnerability, and provenance verification;
- protocol compatibility and malformed/hostile patch tests;
- container escape posture (non-root, no Docker socket, no added capabilities, read-only root);
- cold/warm startup, model availability, timeout, concurrency, memory, and fail-mode tests;
- tenant-isolation and storage-scope tests;
- organization, user, agent-kind, and exact-agent profile precedence tests against the same running container;
- desktop install/enable/update/disable/uninstall/rollback tests;
- warm-pool canary, rolling-update, autoscaling, and rollback tests.

Token Saver uses `npm run release:token-saver`. After `docker login ghcr.io`, this builds a local candidate, blocks on fixable critical/high vulnerability findings (while retaining the full report for upstream findings without a vendor fix), then builds and pushes Linux amd64/arm64 images with provenance and SBOM attestations, reads the real GitHub Container Registry (GHCR) digest, synchronizes every manifest/deployment reference, and runs the production container contract gate. The package must be public so desktop and self-hosted installations can pull it without registry credentials. It never publishes `latest`.

The release command also requests a fresh anonymous GHCR token and reads the published manifest without Docker credentials. A private package, missing tag, or digest mismatch fails the release even if the maintainer's authenticated machine can pull it.

Published version tags are immutable. The command refuses to build or push when that version already exists in GHCR, so every content change requires a new Token Saver version.

## Upload, Release, And Promote

These are separate actions:

| Action | Meaning | Customer impact |
| --- | --- | --- |
| Artifact | Produce something installable for development or testing. | None. |
| Release | Build, verify, sign, and publish an immutable canary. | Canary population only. |
| Promote | Expand a healthy canary through staged rollout to stable. | Gradually reaches customers. |

The target command interface is:

```bash
npm run artifact
npm run release
npm run promote
```

These three commands are the desired interface. Until all three are implemented, use the current commands in [Current Repository Commands](#current-repository-commands).

### `npm run artifact`

- Detect changed components.
- Build development DMGs, containers, web bundles, or mobile packages.
- Generate unique prerelease versions from time, build ID, and commit.
- Upload only to an internal development channel when requested.
- Never modify stable update metadata.

### `npm run release`

- Detect components changed since their last releases.
- Select versions automatically.
- Detect persisted-data and API-contract changes.
- Require immutable migrations and upgrade coverage.
- Run all mandatory release gates.
- Build, sign, checksum, and publish immutable artifacts.
- Generate the release manifest, release notes, and rollback plan.
- Publish to canary, not directly to all customers.

Production release mode must not permit required tests, builds, snapshots, migration checks, signatures, or compatibility gates to be skipped.

### `npm run promote`

- Read health for the selected canary release.
- Refuse promotion when safety thresholds fail.
- Progress through configured rollout stages.
- Pause or withdraw update availability without replacing artifacts.

## Automatic Versioning

No component version should need to be edited by hand during normal development.

The release system determines the next version from changes and release metadata:

- Backward-compatible fixes and internal changes produce a patch bump.
- Backward-compatible features may produce a minor bump.
- Breaking changes require a major bump or, preferably, are blocked until a compatibility path exists.
- Unchanged components are not republished.
- Every build also records its commit and build ID so different artifacts cannot claim the same identity.

Before OpenLeash 1.0, the default may remain a patch bump unless a change is explicitly classified as a minor release. The generated release plan must always be visible before publication.

## A Feature Is Not Finished Without Its Upgrade Path

When a feature changes persisted data or an API contract, completing the feature includes its lifecycle work.

The implementation must answer whether it changes:

- Desktop-local persisted state.
- The Postgres schema or existing Postgres data.
- API requests, responses, headers, or behavior.
- Docker, Compose, Helm, or runtime configuration.
- Plugin settings, manifests, or stored plugin state.

When applicable, the same change must include:

- A new immutable forward migration.
- An upgrade fixture or regression test.
- Old/new component compatibility behavior.
- Post-migration verification.
- Backup and restore implications.
- Observability for failures.
- Release notes and a rollback strategy.

CI must reject schema drift that is not represented by a migration. Release automation should not invent risky data migrations at publication time.

## Desktop SQLite Contract

SQLite is only desktop-local cache, setup state, and legacy-import storage. It is not an OpenLeash backend or the source of truth for Individual Open Source.

Individual Open Source always uses the real `client-api` and Postgres. Desktop cache should be designed so it can be safely reconstructed wherever possible.

Desktop schema evolution must use ordered, immutable, checksummed migrations rather than an ever-growing inline schema adjustment:

```text
apps/desktop-client/migrations/sqlite/
  0001_initial.sql
  0002_add_resolution.sql
  0003_add_skill_content.sql
  0004_rebuild_evaluations.sql
```

Desktop startup migration behavior must be:

1. Acquire a single-process migration/startup lock.
2. Open the database and run `PRAGMA integrity_check`.
3. Read the migration ledger and verify applied checksums.
4. Create a consistent, versioned backup, including WAL state correctly.
5. Apply each pending migration transactionally.
6. Run structural and semantic verification.
7. Start the application only after successful verification.
8. Retain a bounded number of backups.

If migration fails, the application must avoid a destructive retry loop. It restores the pre-upgrade state where safe, enters recovery mode, and reports the exact application version and migration ID.

## Postgres Contract

Postgres is the durable backend store for Individual Open Source, Private Cloud, and OpenLeash Cloud. These modes use the same public-core schema and migration chain.

Postgres migrations must be:

- Ordered and checksummed.
- Immutable after release.
- Protected by a migration lock.
- Transactional when PostgreSQL permits it.
- Applied by one deployment migration job, not concurrently by every API instance.
- Accompanied by post-migration verification.

Production uses two deliberately separate logins:

- `openleash_ops` owns schema objects, runs the one-shot migration job, and is the human operations/DBeaver administrator.
- `openleash` is the application runtime login. It receives the table, sequence, and routine privileges required by the product but does not own the schema.

Production migrations must connect as `openleash_ops`. Default privileges owned by that role must grant runtime access to `openleash`, so every future migration-created object is immediately usable without an emergency one-off grant. Store the operations and runtime connection strings as separate secrets; application services receive only the runtime secret.

A schema-only dump is not a recoverable backup of customer data. Release deployment requires one of:

- A full logical backup for appropriately sized local installations.
- A volume or managed-database snapshot.
- A verified point-in-time-recovery checkpoint.

The backup or recovery identifier must be recorded in the deployment result. Restore procedures must be tested on a schedule rather than assumed to work.

### Expand And Contract

Database changes should normally span compatible releases:

1. Add new nullable columns, tables, or indexes.
2. Deploy code that tolerates both old and new representations.
3. Backfill in bounded, resumable batches.
4. Switch reads to the new representation.
5. Retain the old representation for the compatibility window.
6. Remove obsolete data only in a later release.

Large indexes and rewrites require production-safe strategies. A large backfill should not be hidden inside one long, locking migration transaction.

Each migration should declare operational metadata similar to:

```yaml
risk: high
expectedLocks: "short metadata lock; batched row updates"
estimatedDuration: "5-20 minutes"
requiresBackup: true
rollbackStrategy: "application rollback, then forward repair or restore"
compatibleAppVersions:
  min: 0.36.0
  max: 0.38.x
verification:
  - "new values contain no unexpected nulls"
  - "old and new record counts agree"
```

Application rollback and database rollback are different. Application rollback should remain fast because expand migrations preserve compatibility. Database recovery normally uses forward repair or restore; arbitrary destructive down migrations are not the default.

## Compatibility Contract

Components do not update simultaneously. Every release must support and test the relevant combinations:

```text
new desktop + old compatible API
old desktop + new API
new API + expanded schema
old API + expanded schema during rollout or rollback
current dashboard web + compatible dashboard API
published mobile versions + new API
```

The supported window should be explicit. A starting policy is:

- `client-api` supports the current desktop minor version and the previous two.
- A new desktop supports the current API and the previous compatible API minor version.
- The backend supports the current store-published mobile version and the previous supported version.
- API changes remain additive during the compatibility window.
- Fields are not repurposed.
- Removal requires a deprecation period.
- Unsupported combinations fail clearly before mutating data.

The API should expose its contract range, minimum supported clients, and maintenance state. Version headers are useful only when cross-version behavior is exercised automatically.

## Historical Upgrade Fixtures

Every stable release that changes persisted state becomes a permanent upgrade fixture:

```text
fixtures/upgrades/0.34.0/desktop.sqlite
fixtures/upgrades/0.34.0/postgres.dump
fixtures/upgrades/0.35.0/desktop.sqlite
fixtures/upgrades/0.35.0/postgres.dump
```

Fixtures must be sanitized and contain representative data. CI upgrades every supported historical fixture to the candidate version and verifies:

- All pending migrations apply successfully.
- A second migration run is idempotent.
- Representative settings, data, and relationships survive.
- Record-count and semantic invariants hold.
- Foreign keys and expected indexes are valid.
- SQLite integrity checks succeed.
- The API boots and handles representative requests.
- Compatible old/new client and server combinations work.
- The created backup can actually be restored.

Any migration failure found in production must become a sanitized regression fixture.

## Release Manifest

The generated manifest ties independently versioned components together:

```yaml
release: 2026.07.14.1
createdAt: 2026-07-14T14:30:00Z

components:
  desktop:
    version: 0.37.0
    minApiVersion: 0.40.0
    sha256: "..."
    sqliteSchema: 7

  clientApi:
    version: 0.42.0
    image: ghcr.io/openleash/client-api@sha256:...
    postgresSchema: 34
    supportsDesktop: ">=0.35.0 <0.39.0"

  dashboardWeb:
    version: 0.31.0
    requiresDashboardApi: ">=0.28.0"

migrations:
  postgres:
    from: 33
    to: 34
  desktopCache:
    from: 6
    to: 7
```

Updaters and deployment tooling consume this manifest rather than guessing whether independently uploaded artifacts are compatible.

## Delivery By Product Surface

### Agent Attention Island

Desktop `0.36.8` introduces the versioned `2026-07-19.v1` attention-event
contract. `client-api` is the source of truth for pending policy approvals,
native agent questions, plan reviews, blocked actions, and completion events.
Decision answers are stored in Postgres migration
`0033_agent_interaction_responses` and returned to the waiting hook as bounded
structured data. The desktop legacy/dev relay mirrors the same field in its
SQLite cache migration ledger as `0002_agent_interaction_responses`.

Claude Code and NanoClaw resume their blocked `PreToolUse` hook through
`updatedInput`. OpenCode listens to its public event stream and replies through
its native question API. Other agents receive policy approval and completion
behavior according to their stable hook capabilities; do not claim native
question answering or exact session jumping without an agent-supported API.

The desktop overlay must remain non-activating on first display, top-center,
frameless, transparent, skip-taskbar, and always-on-top on both macOS and
Windows. Approve, deny, answer, dismiss, and auto-dismiss actions close only
the island and must never open the main desktop window as a side effect.

Starting with desktop `0.36.9`, macOS uses the bundled native
`openleash-island` helper: an accessory-process `NSPanel` with the
non-activating panel mask, screen-saver level, all-space/full-screen auxiliary
behavior, and an AppKit frame whose top inset is exactly zero. Electron cannot
provide this geometry because macOS clamps ordinary Electron windows below the
menu-bar height. The helper hosts the same local `notice.html` renderer used by
Windows in a transparent `WKWebView` and communicates with the desktop process
only through bounded JSON lines over its inherited stdin/stdout pipes. It does
not expose a socket or network service.

Starting with desktop `0.36.10`, the helper also reads the active `NSScreen`
safe-area and auxiliary top regions. On a MacBook display with a camera notch,
the panel background remains attached to the physical top edge while compact
and expanded header content begins below the hardware-safe inset. Release
verification must run this geometry check against the real active display and
assert that rendered content clears the reported notch boundary.

Starting with desktop `0.36.11`, polling treats the native island as an active
visible notice even though no Electron `BrowserWindow` exists. Each pending
approval is automatically presented once per desktop process and is not
replayed on every poll or after dismissal. A user can still reopen any pending
approval explicitly from the tray, and a different action receives its own
notification.

The island begins as a compact activity cap and smoothly morphs to its expanded
approval, question, or plan-review dimensions. Its header toggles expansion;
collapsed content must be inert, hidden from the accessibility tree, and
unable to retain keyboard focus. Release verification must exercise the real
native helper and assert top inset zero, compact sizing, expanded sizing, and
dismissal before packaging. The packaged macOS gate must also confirm that the
helper is present outside ASAR and executable.

Windows releases are built and native-ABI-tested on a Windows GitHub runner.
During the current development distribution phase they are intentionally
unsigned and do not require signing secrets. Release notes must disclose that
state, and publication verifies installer bytes against the immutable release
checksum before enabling either platform. Mandatory platform signing can be
restored when production certificates are provisioned.

Release `0.36.11` is published for macOS arm64 at the immutable GitHub tag and
is active in the stable update feed. Its public `install.sh` path downloads the
release assets, verifies both the installer helper and DMG against
`SHA256SUMS`, and installs the packaged native island helper, renderer, and
local agent icons outside ASAR. Individual Open Source remains pinned to the
separately versioned `client-api:0.36.8` multi-architecture digest.
The Windows x64 package passed the real Windows runner and native SQLite ABI
gate, but remains absent from the public feed until the code-signing secrets
above are configured. The website must describe Windows as pending rather than
linking to an unsigned artifact.

### Desktop Client

The desktop update flow must:

1. Select a release compatible with the configured backend.
2. Download in the background.
3. Verify signature and checksum.
4. Install atomically.
5. Back up and migrate desktop-local cache.
6. Start the candidate version and run a health check.
7. Recover the previous application/cache or enter recovery mode when startup fails.

Desktop artifacts are published to internal, canary, and stable update channels. Update availability can be paused without altering an already published artifact.

### Individual Open Source

The local runtime is a pinned bundle containing exact image digests and migration compatibility information. It must not float on mutable `latest` images.

The intended user action is a desktop button or:

```bash
openleash update-runtime
```

The updater pulls exact images, creates a recoverable Postgres backup, runs one migration job, verifies the database, recreates services, and performs end-to-end health checks. Application containers can roll back when unhealthy; database recovery follows the migration rollback strategy.

### Private Cloud

Customer operators control upgrade timing. Publish immutable image digests, versioned Compose/Helm bundles, preflight checks, migration jobs, compatibility metadata, and recovery guidance.

The intended operator interface is:

```bash
openleash upgrade 2026.07.14.1
```

### OpenLeash Cloud

Deploy in this order:

```text
backup or PITR marker
→ expand migration
→ API canary
→ API rollout
→ dashboard/web rollout
→ desktop availability
→ delayed contract migration
```

Cloud deployment must preserve compatibility with older desktop and mobile clients throughout their support windows.

### Mobile Client

The pipeline automatically increments the iOS build number and Android version code for every store upload, and changes the marketing version when required. Backend releases cannot assume the new mobile binary has passed review or reached users.

## Mandatory Release Gates

### Desktop

- Clean, reproducible build.
- Unit and integration tests.
- Every supported SQLite upgrade fixture.
- Packaged-artifact startup and native-module verification.
- Current and previous compatible API tests.
- Install-over-existing-version tests on supported operating systems.
- Signing and notarization verification when production credentials are enabled; otherwise explicit unsigned-release labeling and checksum verification.
- Update-manifest signature and checksum verification.
- Canary publication before stable rollout.

### Backend

- Migration checksum and schema-drift validation.
- Every supported Postgres upgrade fixture.
- Recoverable backup and scheduled restore rehearsal.
- Old/new API compatibility tests.
- Migration duration and lock-risk review.
- One-shot migration job.
- Canary API deployment and real-flow smoke tests.
- Progressive traffic rollout with automatic stopping.

### Web And Mobile

- API compatibility tests.
- Production configuration validation.
- Signed production artifacts where applicable.
- Store/build-number validation for mobile.
- Smoke tests against the target API release.

## Progressive Rollout And Observability

Stable desktop and backend releases should progress through stages such as:

```text
internal → canary 1% → 10% → 25% → 50% → 100%
```

Promotion depends on release health, including:

- Successful update and startup rate.
- Migration failures grouped by migration ID and source version.
- Crash-free sessions.
- API incompatibility responses.
- Backend error rates and latency.
- Postgres migration and backfill health.

Telemetry must remain privacy appropriate. The operational system should still be able to answer whether a specific migration fails on a particular platform or source version. Threshold regressions pause rollout automatically.

## Current Repository Commands

The target workflow above is not fully implemented yet. The following commands describe the current repository behavior.

### Normal Development

```bash
python3 build.py --changed
python3 test.py --upgrade
```

### Before Commit Or Push

```bash
npm run test:deployment
npm run test:upgrade
npm run smoke:product
```

### Release Candidate

Run the full release gate:

```bash
npm run release:check
```

Equivalent:

```bash
python3 build.py --full
python3 test.py --full
```

Do not release unless this passes.

The current app-aware release conductor is:

```bash
npm run release:prep
```

It detects selected/changed applications, prepares versions and release metadata, runs configured gates, and can commit, tag, or push when explicitly requested. Its production path must evolve toward the non-bypassable artifact/release/promote workflow defined above.

### Mandatory Release Definition Of Done

This is the canonical checklist for every OpenLeash release. A release is not
complete merely because `release.py` exits successfully or tags are pushed.
The operator must finish every applicable row below and record skipped rows as
`not applicable` with the reason.

Start by selecting all changed public and hosted repositories:

```bash
PG_DUMP=/path/to/pg_dump \
python3 release.py --all-changed --include-cloud --ship --yes
```

An explicitly scoped release may use one or more `--app name=version` arguments,
but its dependency impact must still be evaluated against the full matrix.

| Change | Required release work | Required verification |
| --- | --- | --- |
| `desktop-client` | Build and publish the versioned DMG/blockmap/checksums and installer helper; publish the stable update record; update and deploy `main-web`/`install.sh`. | Native notch and plain-display tests, packaged ABI check, public GitHub assets, update API hash/version, live `install.sh`, installed bundle version. |
| Public `client-api` | Publish the immutable multi-architecture `ghcr.io/open-leash/client-api:<version>@<digest>` image. Update any desktop/installer runtime pin that should consume it. | Anonymous GHCR pull by digest, upgrade fixtures, health check, Individual Open Source install, and Private Cloud deployment artifact. |
| `cloud-client-api` or public core consumed by it | Update the wrapper's pinned public-core commit, release the wrapper, build its immutable Artifact Registry image, and deploy Cloud Run only after migrations succeed. | `https://api.openleash.com/health`, representative authenticated hook/proxy request, and compatibility with the current and previous supported desktop clients. |
| Core or cloud Postgres schema/migrations | Review generated SQL for destructive statements and backfills. Back up production Cloud SQL, then run `python3 migrate.py --target gcp --scope all --backup-apply --yes` before deploying dependent APIs. | `python3 migrate.py --target gcp --scope all --status --yes` reports no pending migrations; API startup schema validation and health pass. Never print database URLs or credentials. |
| `dashboard-api`/`dashboard-web` | Publish the public Private Cloud artifacts. If the hosted wrappers consume the change, update their pinned commits and deploy `cloud-dashboard-api`/`cloud-dashboard-web`. | Private Cloud build/health plus hosted dashboard smoke tests and tenant authorization checks. |
| Token Saver/plugin runtime | Publish the immutable plugin image and manifest digest, update consuming runtime pins/catalog metadata, and deploy the hosted warm pool when applicable. | Anonymous image verification, container protocol tests, local container reconciliation, hosted runtime health, and visible savings telemetry. |
| `main-web`/docs/mobile/provider services | Publish and deploy only the affected artifact using its documented pipeline. | Production URL/store/artifact smoke check appropriate to that surface. |

Mode coverage is mandatory whenever shared contracts or runtime dependencies
change:

- **OpenLeash Cloud:** production Cloud SQL migrations first, then hosted API
  wrappers, web surfaces, health checks, and client compatibility.
- **Individual Open Source:** published public `client-api` image, Postgres
  migrations, installer/runtime pins, and a clean install/upgrade test.
- **Private Cloud:** published public API/dashboard images and migrations, with
  no dependency on private OpenLeash Cloud code or credentials.

Production credentials must be read from the approved secret manager without
printing them. If a credential appears in terminal, CI, tool, or release output,
treat it as compromised: rotate it, publish the replacement secret version,
disable the exposed version, and verify dependent services before continuing.

For a UI-only release, backend images and databases should not be redeployed.
Mark those rows `not applicable: no API, runtime dependency, or schema change`.
This is an intentional safety decision, not a skipped release step.

`release.py` currently owns selection, versioning, schema synchronization,
tests, builds, release notes, rollback metadata, commits, tags, and pushes.
GitHub release creation, update-feed promotion, immutable image publication,
Cloud Run promotion, production migration application, and live smoke tests are
explicit operational stages until they are implemented as non-bypassable
conductor stages. Do not report a release as complete before those applicable
stages finish.

### Manual DMG Build

```bash
npm run dist:personal
node scripts/verify-packaged-desktop.mjs
npm rebuild better-sqlite3
python3 test.py --upgrade
```

The distributable command rebuilds `better-sqlite3` for the pinned Electron version. The verification command loads the packaged native module using that Electron runtime. Rebuild it for Node before running Node-based tests.

### Verified 0.36.3 Baseline

The first release using this path is desktop `0.36.3`. Its immutable runtime bundle is:

- client API: `ghcr.io/open-leash/openleash-client-api:0.36.3@sha256:c01b6c9997968ddcd9f07d0a9c87ac9537bd829233c9ece9550786e52e29c157`;
- local proxy: `ghcr.io/open-leash/local-proxy:0.36.3@sha256:a82ab662a520cca6879b359f13f51e5e45e3a0679db4ebcb93c51e7d7cd382f0`;
- Token Saver: `ghcr.io/open-leash/token-saver:1.1.0@sha256:bc36ea66eb9694cc9e45d160a0a589c410fd61a6b4b0b91caaaedd6a370637f1`;
- dashboard web: `ghcr.io/open-leash/openleash-dashboard-web:0.36.3@sha256:647ff046e0d7149b8b9782264993cc33eb85b692c4dff0962d1443c6012b32af`;
- Postgres: `postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`;
- latest migration: `0029_plugin_container_execution`.

Publish core images with `npm run release:runtime-image -- --name <name> --version <version> --dockerfile <file> --context <dir>`. It refuses existing tags, builds amd64/arm64, attaches provenance and an SBOM, blocks fixable high/critical vulnerabilities, records the digest, and verifies anonymous access. New GHCR packages are private by default; Public visibility and the anonymous pull gate are mandatory.

The website bootstrap is pinned to one desktop tag. Its GitHub release must contain the installer, versioned DMG, and `SHA256SUMS`. The bootstrap verifies the release tag and both files. The in-app updater rejects updates without a valid SHA-256 and verifies the DMG before installation.

After publishing the GitHub release, run `npm run release:desktop-feed -- --version <version> --dry-run`, then rerun without `--dry-run` with `OPENLEASH_RELEASE_ADMIN_TOKEN` set. This re-downloads and hashes the public DMG, publishes the exact metadata to `client-api`, and reads the public update feed back before succeeding.

### Repository-Named 0.36.4 Runtime

Starting with `0.36.4`, an OCI package has the same name as the GitHub source
repository that builds it. The immutable runtime bundle is:

- client API (also used for the dashboard API surface): `ghcr.io/open-leash/client-api:0.36.8@sha256:4b90ab8b4f7f83141923057bdd32b651584d03c9e8ec783f9d5ab9aa578e3cc5`;
- dashboard web: `ghcr.io/open-leash/dashboard-web:0.36.5@sha256:203ae32548f7242f7d50d7efb84569de987f4dcec024ad04035f8d815f1cebd1`;
- Token Saver: `ghcr.io/open-leash/plugin-token-saver:1.1.1@sha256:4b681430b8455c42e2bdcc66500fc60c5b4bc197eb3db4817fb44cd69d6814c5`;
- local proxy (unchanged): `ghcr.io/open-leash/local-proxy:0.36.3@sha256:a82ab662a520cca6879b359f13f51e5e45e3a0679db4ebcb93c51e7d7cd382f0`.
- latest public-core migration: `0033_agent_interaction_responses`.

The `client-api`, `dashboard-web`, and `plugin-token-saver` repositories each
contain their own Dockerfile and immutable multi-architecture GHCR publishing
workflow. `dashboard-api` deliberately selects the dashboard surface of the
same `client-api` runtime instead of publishing duplicate bytes under another
package name. Internal Compose service and container names are not package
identities and may retain an `openleash-` prefix.

## Implementation Roadmap

1. Replace inline desktop schema evolution with true ordered SQLite migrations.
2. Preserve sanitized SQLite and Postgres fixtures for every stable schema release.
3. Replace schema-only backup assumptions with recoverable data backup/PITR records.
4. Generate one release manifest and enforce a compatibility matrix.
5. Create immutable internal, canary, and stable artifact channels.
6. Make component version selection automatic.
7. Exercise old/new client and server combinations in CI.
8. Make mandatory production gates impossible to skip.
9. Add staged promotion and automatic rollout stopping.
10. Add the pinned Individual Open Source runtime updater.
11. Schedule backup-restore drills and historical upgrade rehearsals.

The final operational objective is simple: the developer says **release everything that changed**, and the system either publishes a verified canary or stops before customer impact with the exact failing gate.
