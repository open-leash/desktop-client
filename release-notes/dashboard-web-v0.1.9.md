# OpenLeash dashboard-web-v0.1.9

Generated: 2026-08-02T18:13:37.670306+00:00

## Released Apps

- `apps/dashboard-web`: `0.1.9` -> `0.1.9` (`v0.1.9`)

## Changed Files

### `.`
- `apps/dashboard-web`
- `apps/desktop-client`

### `apps/dashboard-web`
- `Dockerfile`
- `package.json`

### `apps/desktop-client`
- `.github/workflows/release-macos.yml`
- `.github/workflows/release-windows.yml`
- `package.json`
- `src/main.ts`

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
