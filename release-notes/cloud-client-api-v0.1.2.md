# OpenLeash cloud-client-api-v0.1.2

Generated: 2026-07-20T15:12:25.549292+00:00

## Released Apps

- `apps/cloud-client-api`: `0.1.2` -> `0.1.2` (`v0.1.2`)

## Changed Files

### `apps/cloud-client-api`
- `Dockerfile`
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
