# OpenLeash client-api-v0.36.32

Generated: 2026-08-01T17:15:20.374149+00:00

## Released Apps

- `apps/client-api`: `0.36.32` -> `0.36.32` (`v0.36.32`)

## Changed Files

### `apps/client-api`
- `package.json`
- `infra/postgres/migrations/0043_remove_unused_legacy_seed_identity.sql`

## Migration Safety

- Postgres migrations ship from `infra/postgres/migrations/` and are applied through `schema_migrations`.
- Desktop local cache/setup storage migrates on app startup; product authority stays in the backend.
- Mobile has no durable local SQLite migration runner until a committed local schema exists.
- Production/on-prem deploys should run `npm run db:migrate:backup` before starting APIs.

## Rollback

- App rollback: deploy the previous artifact or app repo tag from the rollback manifest.
- Postgres rollback: restore the pre-migration backup created by `npm run db:migrate:backup`.
- Desktop/mobile local cache rollback: ship a forward fix; do not downgrade user-local cache storage automatically.
