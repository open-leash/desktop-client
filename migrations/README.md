# Migration Candidates

`prepare-migration.py` writes reviewable migration candidates here:

```text
migrations/[client-name]/[YYYYMMDD-HHMMSSZ].sql
```

The generated file includes a commented schema diff. Postgres candidates include
the current idempotent canonical schema body. SQLite candidates are templates
because SQLite migrations often need hand-written data movement.
