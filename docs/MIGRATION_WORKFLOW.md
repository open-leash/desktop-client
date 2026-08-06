# Database migration workflow

Leash has one public durable backend schema: Postgres owned by `client-api`. Desktop SQLite is a local cache/setup store and has its own upgrade fixtures.

1. Update `infra/postgres/schema.sql` and the mirrored `apps/client-api` schema.
2. Add an append-only numbered migration to both migration directories.
3. Run `npm run schema:snapshot -- client-api desktop-client`.
4. Run `npm run test:upgrade` against representative old fixtures.
5. Confirm applying the migration twice is safe.
6. Back up production, run `npm run db:migrate:backup`, verify health, and retain the documented rollback plan.

Compatibility tables may retain old organization, dashboard-session, or plugin-marketplace names, but no new public behavior may depend on those retired product surfaces.
