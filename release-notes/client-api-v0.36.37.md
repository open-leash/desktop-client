# OpenLeash client-api-v0.36.37

Generated: 2026-08-02T18:08:12.073285+00:00

## Released Apps

- `apps/client-api`: `0.36.37` -> `0.36.37` (`v0.36.37`)

## Changed Files

### `.`
- `apps/client-api`
- `apps/dashboard-web`
- `apps/desktop-client`
- `package-lock.json`
- `package.json`
- `release.py`
- `infra/postgres/migrations/0032_client_api_0_36_36.sql`
- `release-notes/client-api-v0.36.36.md`
- `release-notes/client-api-v0.36.36.rollback.json`

### `apps/client-api`
- `Dockerfile`

### `apps/dashboard-web`
- `Dockerfile`
- `package.json`

### `apps/desktop-client`
- `package.json`

### `apps/main-web`
- `Dockerfile`
- `app/account/AccountClient.tsx`
- `package.json`
- `public/install.sh`

## Migration Safety

- Postgres migrations ship from `infra/postgres/migrations/` and are applied through `schema_migrations`.
- Desktop local cache/setup storage migrates on app startup; product authority stays in the backend.
- Mobile has no durable local SQLite migration runner until a committed local schema exists.
- Production/on-prem deploys should run `npm run db:migrate:backup` before starting APIs.

## Rollback

- App rollback: deploy the previous artifact or app repo tag from the rollback manifest.
- Postgres rollback: restore the pre-migration backup created by `npm run db:migrate:backup`.
- Desktop/mobile local cache rollback: ship a forward fix; do not downgrade user-local cache storage automatically.
