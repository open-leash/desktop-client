# OpenLeash Migration Workflow

This repo has three persistence surfaces:

- Postgres for `client-api`, `dashboard-api`, `cloud-client-api`, and `cloud-dashboard-api`.
- Desktop-local cache/state storage for `desktop-client`.
- No committed mobile SQLite schema yet; `mobile-client` should get versioned SQLite migrations when a real local cache DB is introduced.

## The Rule

Snapshots are developer evidence. Runtime migrations are shipped product code.

```text
snapshots/[client]/...              captured live schema before release
migrations/[client]/...             generated draft migration candidates
infra/postgres/migrations/...       shipped Postgres migrations
apps/client-api/infra/postgres/...  shippable mirror inside the client-api repo
desktop-client startup migration    shipped desktop SQLite migrations
```

Do not deploy generated draft files directly. Review them, edit them, then promote the final SQL into the runtime migration location.

`release.py` keeps the `apps/client-api/infra/postgres` mirror in sync so a
client-api repo tag contains the migrations it needs.

## Normal Feature Workflow

1. Snapshot the current DB shape before schema work:

   ```bash
   npm run schema:snapshot -- client-api dashboard-api desktop-client
   ```

2. Build the feature and update schema code.

3. Prepare a migration candidate:

   ```bash
   npm run schema:prepare-migration -- client-api
   ```

4. Review and edit the generated file under `migrations/client-api/`.

5. Promote the reviewed Postgres SQL into `infra/postgres/migrations/` with the next ordered name:

   ```bash
   npm run schema:finalize-migration -- client-api migrations/client-api/20260614-120000Z.sql --name add_example_table
   ```

6. Test upgrades:

   ```bash
   python3 test.py --upgrade
   ```

## One-Command Release

Run the interactive release assistant:

```bash
npm run release:prep
```

It detects changed app repos, asks which apps to release, suggests the next
patch version per app, then runs the selected release plan.

Preview the detected release plan:

```bash
npm run release:prep -- --ship --dry-run
```

Release only one app with an explicit app version:

```bash
npm run release:prep -- --app desktop-client=0.36.0 --ship
```

Release every changed app without prompts, using each app's next patch version:

```bash
npm run release:prep -- --all-changed --ship
```

Use one shared version only when you intentionally want a release train:

```bash
npm run release:prep -- --version 0.36.0 --all-changed --ship
```

On a machine without live DB access or `pg_dump`, use this only for a packaging
dry run, not for a final release:

```bash
npm run release:prep -- --allow-snapshot-failures
```

The release assistant:

- runs the Product.md/user-flow contract guard before changing release files,
- bump package versions,
- leaves unselected apps at their existing versions,
- creates a Postgres schema-sync migration if the canonical `apps/client-api/infra/postgres/schema.sql` changed,
- snapshot DB schemas for the selected apps that own DBs,
- run the tests relevant to selected apps,
- build release targets for selected apps,
- update `main-web` desktop download links when `desktop-client` is released,
- write release notes and a rollback manifest,
- commit, tag, and push changed app repos.

Selected app gates:

- `client-api`, `dashboard-api`, and cloud API wrappers: Postgres snapshot, Postgres upgrade fixtures, typecheck, build.
- `desktop-client`: desktop SQLite upgrade fixtures, typecheck, build, desktop distributable.
- `mobile-client`: Flutter analyze/test, production Android App Bundle, production iOS IPA. The iOS build expects local Apple signing/export setup; if signing is missing, the release stops.
- Web apps: typecheck and production build.

Desktop release links default to GitHub Releases:

```bash
npm run release:prep -- --app desktop-client=0.36.0 --ship
```

Use GCS only for a release that intentionally publishes desktop artifacts to the public bucket:

```bash
npm run release:prep -- --app desktop-client=0.36.0 --desktop-download-host gcs --ship
```

Versioning is per app. `desktop-client` can release `0.36.0` while
`mobile-client` stays `1.0.0+1`.

Because this checkout uses separate Git repos under `apps/*`, the release script
commits/tags/pushes changed app repos. If the root directory has no `.git`,
top-level release files such as docs and `infra/postgres/migrations` cannot be
auto-committed from this checkout.

## Applying Postgres Migrations

Postgres migrations are run by the deployment/operator before APIs start. APIs should validate schema readiness, not create or migrate tables during startup.

```bash
python3 migrate.py --target custom --database-url 'postgres://...' --scope core --backup-apply --yes
```

That command:

- creates a schema-only backup with `pg_dump`,
- takes a Postgres advisory lock,
- ensures the migration ledger during apply,
- applies unapplied files in `infra/postgres/migrations/`,
- verifies checksums for already-applied migrations.

If `pg_dump` is not on `PATH`, install PostgreSQL client tools or set:

```bash
PG_DUMP=/path/to/pg_dump python3 migrate.py --target custom --database-url 'postgres://...' --scope core --backup-apply --yes
```

Local development can use:

```bash
python3 migrate.py --target local --scope core --apply --yes
```

OpenLeash Cloud wrapper deploys use both public core and cloud wrapper migrations:

```bash
python3 migrate.py --target gcp --scope all --backup-apply --yes
```

## App Ownership

`client-api` and `dashboard-api` use the same public Postgres schema. Run the Postgres migration job once per target database before starting either API.

`cloud-client-api` and `cloud-dashboard-api` are private wrappers over the same core schema. OpenLeash Cloud deploys run the same migration job against the OpenLeash Cloud database before starting cloud services.

`desktop-client` may keep local cache/state tables for tray UX, setup state, and endpoint inventory, but this is not a supported fully local product mode. Backend-owned product data should live in Postgres.

`mobile-client` should not have a migration runner until it has a committed local SQLite schema. If the local DB is only cache, prefer wipe-and-rebuild cache tables over durable migrations.

## Safety Rules

- Never edit a migration after it has been applied anywhere durable; add a new migration.
- Back up production Postgres before applying migrations.
- Keep destructive data changes explicit and reviewed.
- Run upgrade fixtures before release.
- Desktop product behavior requires a backend; avoid adding durable product authority to endpoint-local storage.
