# OpenLeash cloud-client-api-v0.1.1

Generated: 2026-07-20T12:57:25.775402+00:00

## Released Apps

- `apps/cloud-client-api`: `0.1.1` -> `0.1.1` (`v0.1.1`)

## Changed Files

### `apps/desktop-client`
- `package.json`

### `apps/main-web`
- `Dockerfile`
- `app/account/AccountClient.tsx`
- `components/redesign/site.jsx`
- `public/install.sh`

### `apps/cloud-client-api`
- `package.json`

## Migration Safety

- Postgres migrations ship from `infra/postgres/migrations/` and are applied through `schema_migrations`.
- Desktop local cache/setup storage migrates on app startup; product authority stays in the backend.
- Mobile has no durable local SQLite migration runner until a committed local schema exists.
- Production/on-prem deploys should run `npm run db:migrate:backup` before starting APIs.

## Rollback

- App rollback: deploy the previous artifact or app repo tag from the rollback manifest.
- Postgres rollback: restore the pre-migration backup created by `npm run db:migrate:backup`.
- Desktop/mobile local cache rollback: ship a forward fix; do not downgrade user-local cache storage automatically.
