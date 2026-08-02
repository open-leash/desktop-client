# OpenLeash client-api-v0.36.36

Generated: 2026-08-02T18:05:43.226005+00:00

## Released Apps

- `apps/client-api`: `0.36.36` -> `0.36.36` (`v0.36.36`)

## Changed Files

### `.`
- `apps/client-api`
- `apps/dashboard-web`
- `apps/desktop-client`
- `package-lock.json`
- `package.json`
- `release.py`
- `infra/postgres/migrations/0032_client_api_0_36_36.sql`

### `apps/client-api`
- `package.json`
- `infra/postgres/migrations/0032_client_api_0_36_36.sql`

### `apps/dashboard-web`
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
