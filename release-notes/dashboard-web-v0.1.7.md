# OpenLeash dashboard-web-v0.1.7

Generated: 2026-08-01T17:02:04.854973+00:00

## Released Apps

- `apps/dashboard-web`: `0.1.7` -> `0.1.7` (`v0.1.7`)

## Changed Files

### `apps/dashboard-web`
- `Dockerfile`

### `apps/main-web`
- `Dockerfile`

## Migration Safety

- Postgres migrations ship from `infra/postgres/migrations/` and are applied through `schema_migrations`.
- Desktop local cache/setup storage migrates on app startup; product authority stays in the backend.
- Mobile has no durable local SQLite migration runner until a committed local schema exists.
- Production/on-prem deploys should run `npm run db:migrate:backup` before starting APIs.

## Rollback

- App rollback: deploy the previous artifact or app repo tag from the rollback manifest.
- Postgres rollback: restore the pre-migration backup created by `npm run db:migrate:backup`.
- Desktop/mobile local cache rollback: ship a forward fix; do not downgrade user-local cache storage automatically.
