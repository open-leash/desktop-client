import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import "dotenv/config";
import { ensureDevToken, pool } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appMigrationsPath = path.resolve(here, "../infra/postgres/migrations");
const repoMigrationsPath = path.resolve(here, "../../../infra/postgres/migrations");
const appSchemaPath = path.resolve(here, "../infra/postgres/schema.sql");
const repoSchemaPath = path.resolve(here, "../../../infra/postgres/schema.sql");

const args = new Set(process.argv.slice(2));
const shouldApply = args.has("--apply") || process.env.OPENLEASH_MIGRATION_APPLY === "1";
const shouldList = args.has("--list");
const shouldStatus = args.has("--status") || args.has("--pending");
const shouldBackup = args.has("--backup") || process.env.OPENLEASH_MIGRATION_BACKUP === "1";
const backupDir = process.env.OPENLEASH_MIGRATION_BACKUP_DIR
  ?? path.resolve(here, "../../../backups/postgres");
const migrationLogDir = process.env.OPENLEASH_MIGRATION_LOG_DIR;

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://openleash:openleash@localhost:9543/openleash";
let migrationAuditPath: string | undefined;

try {
  if (args.has("--help") || args.has("-h")) {
    printUsage();
    process.exit(0);
  }

  migrationAuditPath = await createMigrationAuditLog("core");

  if (shouldBackup) {
    await backupPostgres(databaseUrl, backupDir);
    if (!shouldApply && !shouldList && !shouldStatus) {
      console.log("[db:migrate] backup complete; no migrations applied.");
      await finishMigrationAudit("SUCCESS");
      await pool.end();
      process.exit(0);
    }
  }

  const migrations = await loadMigrations();
  if (shouldList || shouldStatus) {
    await printMigrationStatus(migrations, "CURRENT STATE");
  } else if (!shouldApply) {
    console.error(
      "[db:migrate] refusing to mutate the database without --apply. " +
      "Use --status to inspect pending migrations or --apply to run them."
    );
    await finishMigrationAudit("REFUSED");
    process.exitCode = 2;
  } else {
    await withMigrationLock(async () => {
      await ensureMigrationLedger();
      await printMigrationStatus(migrations, "BEFORE");
      await auditPendingMigrationSql(migrations);
      if (migrations.length === 0) {
        await applyLegacySchemaFallback();
      } else {
        for (const migration of migrations) {
          await applyMigration(migration);
        }
      }
      await removeLegacyMockIdentityRows();
      await ensureDevToken();
      await printMigrationStatus(migrations, "AFTER");
    });
  }

  if (shouldApply) console.log("Leash database schema is ready.");
  await finishMigrationAudit("SUCCESS");
} catch (error) {
  await finishMigrationAudit("FAILED", error);
  throw error;
} finally {
  await pool.end();
}

type Migration = {
  id: string;
  path: string;
  sql: string;
  checksum: string;
};

async function loadMigrations(): Promise<Migration[]> {
  const migrationsPath = await existingPath(appMigrationsPath, repoMigrationsPath);
  if (!migrationsPath) return [];
  const files = (await fs.readdir(migrationsPath))
    .filter((file) => /^\d+.*\.sql$/i.test(file))
    .sort((left, right) => left.localeCompare(right));

  const migrations: Migration[] = [];
  for (const file of files) {
    const fullPath = path.join(migrationsPath, file);
    const sql = await fs.readFile(fullPath, "utf8");
    migrations.push({
      id: file.replace(/\.sql$/i, ""),
      path: fullPath,
      sql,
      checksum: crypto.createHash("sha256").update(sql).digest("hex")
    });
  }
  return migrations;
}

async function ensureMigrationLedger() {
  const sql = `
    create table if not exists schema_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;
  await auditSql("Ensure migration ledger", sql);
  await pool.query(sql);
}

async function applyMigration(migration: Migration) {
  const existing = await pool.query<{ checksum: string }>(
    "select checksum from schema_migrations where id = $1",
    [migration.id]
  );
  if (existing.rows[0]) {
    if (existing.rows[0].checksum !== migration.checksum) {
      throw new Error(
        `Migration ${migration.id} checksum changed after it was applied. ` +
        "Create a new migration instead of editing applied migrations."
      );
    }
    console.log(`[db:migrate] ${migration.id} already applied`);
    return;
  }

  console.log(`[db:migrate] applying ${migration.id}`);
  await audit("executing: BEGIN");
  await pool.query("begin");
  try {
    await auditSql(`Migration ${migration.id}`, migration.sql, migration.checksum);
    await pool.query(migration.sql);
    await audit(
      "executing: insert into schema_migrations (id, checksum) values ($1, $2) " +
      `[id=${migration.id}, checksum=${migration.checksum}]`
    );
    await pool.query(
      "insert into schema_migrations (id, checksum) values ($1, $2)",
      [migration.id, migration.checksum]
    );
    await audit("executing: COMMIT");
    await pool.query("commit");
  } catch (error) {
    await audit("executing after error: ROLLBACK");
    await pool.query("rollback");
    throw error;
  }
}

async function printMigrationStatus(migrations: Migration[], label = "CURRENT STATE") {
  const applied = await readMigrationLedger();
  const appliedById = new Map(applied.map((row) => [row.id, row]));
  await auditSection(label);
  await report(`Database: ${redactDatabaseUrl(databaseUrl)}`);
  await report(`Migrations: ${migrations.length}`);
  for (const migration of migrations) {
    const row = appliedById.get(migration.id);
    if (!row) {
      await report(`pending  ${migration.id}  ${path.basename(migration.path)}`);
    } else if (row.checksum !== migration.checksum) {
      await report(`changed  ${migration.id}  applied=${row.applied_at.toISOString()}`);
    } else {
      await report(`applied  ${migration.id}  ${row.applied_at.toISOString()}`);
    }
  }
  const known = new Set(migrations.map((migration) => migration.id));
  for (const row of applied) {
    if (!known.has(row.id)) await report(`orphan   ${row.id}  ${row.applied_at.toISOString()}`);
  }
}

async function auditPendingMigrationSql(migrations: Migration[]) {
  const applied = await readMigrationLedger();
  const appliedIds = new Set(applied.map((row) => row.id));
  await auditSection("SQL SELECTED FOR EXECUTION");
  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
  if (pending.length === 0) {
    await audit("No pending migration SQL.");
    return;
  }
  for (const migration of pending) {
    await auditSql(`Migration ${migration.id}`, migration.sql, migration.checksum);
  }
}

async function readMigrationLedger() {
  const exists = await pool.query<{ exists: boolean }>("select to_regclass('schema_migrations') is not null as exists");
  if (!exists.rows[0]?.exists) return [] as { id: string; checksum: string; applied_at: Date }[];
  const applied = await pool.query<{ id: string; checksum: string; applied_at: Date }>(
    "select id, checksum, applied_at from schema_migrations order by id asc"
  );
  return applied.rows;
}

function redactDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:****@");
  }
}

async function createMigrationAuditLog(scope: string) {
  if (!migrationLogDir) return undefined;
  await fs.mkdir(migrationLogDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const logPath = path.join(migrationLogDir, `migration-${stamp}-${scope}.log`);
  await fs.writeFile(
    logPath,
    [
      "Leash PostgreSQL migration audit",
      `started_at: ${new Date().toISOString()}`,
      `scope: ${scope}`,
      `database: ${redactDatabaseUrl(databaseUrl)}`,
      `action: ${shouldApply ? "apply" : shouldBackup ? "backup" : "status"}`,
      "credentials: redacted; sensitive SQL parameter values are not logged",
      ""
    ].join("\n"),
    "utf8"
  );
  console.log(`[db:migrate] audit log: ${logPath}`);
  return logPath;
}

async function audit(message = "") {
  if (!migrationAuditPath) return;
  await fs.appendFile(migrationAuditPath, `${message}\n`, "utf8");
}

async function auditSection(title: string) {
  await audit();
  await audit(`===== ${title} =====`);
}

async function report(message: string) {
  console.log(message);
  await audit(message);
}

async function auditSql(label: string, sql: string, checksum?: string) {
  const suffix = checksum ? ` sha256=${checksum}` : "";
  await audit(`----- BEGIN ${label}${suffix} -----`);
  await audit(sql.trim());
  await audit(`----- END ${label} -----`);
}

async function finishMigrationAudit(status: "SUCCESS" | "FAILED" | "REFUSED", error?: unknown) {
  if (!migrationAuditPath) return;
  const logPath = migrationAuditPath;
  await auditSection("OUTCOME");
  await audit(`status: ${status}`);
  await audit(`finished_at: ${new Date().toISOString()}`);
  if (error) await audit(`error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  console.log(`[db:migrate] audit log: ${logPath}`);
  migrationAuditPath = undefined;
}

function printUsage() {
  console.log(`Leash database migrations

Usage:
  DATABASE_URL=postgres://... npm run db:migrate -w @openleash/client-api -- --status
  DATABASE_URL=postgres://... npm run db:migrate -w @openleash/client-api -- --backup
  DATABASE_URL=postgres://... npm run db:migrate -w @openleash/client-api -- --apply
  DATABASE_URL=postgres://... npm run db:migrate -w @openleash/client-api -- --backup --apply

Options:
  --status   Show applied, pending, changed, and orphan migrations.
  --list     Alias of --status.
  --backup   Write a schema-only pg_dump before doing anything else.
  --apply    Apply pending migrations. Required for database mutations.
`);
}

async function applyLegacySchemaFallback() {
  const schemaPath = await existingPath(appSchemaPath, repoSchemaPath);
  if (!schemaPath) throw new Error("No Postgres schema or migration directory was found.");
  console.log("[db:migrate] no migration files found; applying legacy schema.sql fallback");
  const sql = await fs.readFile(schemaPath, "utf8");
  await auditSql("Legacy schema fallback", sql);
  await pool.query(sql);
}

async function withMigrationLock(fn: () => Promise<void>) {
  const lockId = 873177295;
  await audit(`executing: select pg_advisory_lock($1) [lock_id=${lockId}]`);
  await pool.query("select pg_advisory_lock($1)", [lockId]);
  try {
    await fn();
  } finally {
    await audit(`executing: select pg_advisory_unlock($1) [lock_id=${lockId}]`);
    await pool.query("select pg_advisory_unlock($1)", [lockId]);
  }
}

async function existingPath(...candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next packaged/repo path.
    }
  }
  return undefined;
}

async function backupPostgres(connectionString: string, outputDir: string) {
  const pgDump = process.env.PG_DUMP || "pg_dump";
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const outputPath = path.join(outputDir, `openleash-${stamp}.schema.sql`);
  await fs.mkdir(outputDir, { recursive: true });
  await auditSection("BACKUP");
  await audit(
    `executing: ${pgDump} --schema-only --no-owner --no-privileges --file ${outputPath} ${redactDatabaseUrl(connectionString)}`
  );
  await run(pgDump, [
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    "--file",
    outputPath,
    connectionString
  ]);
  console.log(`[db:migrate] backup wrote ${outputPath}`);
}

function run(command: string, commandArgs: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      env: process.env
    });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error(`${command} was not found. Install PostgreSQL client tools or set PG_DUMP=/path/to/pg_dump.`));
      } else {
        reject(error);
      }
    });
  });
}

async function removeLegacyMockIdentityRows() {
  const statements = [`
    delete from identity_group_members
    where user_id in (
      select id from users
      where email ilike '%@northwind.example'
         or idp_user_id in ('usr-max', 'usr-margaret', 'usr-jenny', 'usr-floyd', 'usr-kristin', 'usr-robert')
    )
       or group_id in (
      select id from identity_groups
      where idp_group_id in ('grp-security', 'grp-platform', 'grp-product', 'grp-contractors')
    )
  `, `
    delete from role_assignments
    where user_id in (
      select id from users
      where email ilike '%@northwind.example'
         or idp_user_id in ('usr-max', 'usr-margaret', 'usr-jenny', 'usr-floyd', 'usr-kristin', 'usr-robert')
    )
       or group_id in (
      select id from identity_groups
      where idp_group_id in ('grp-security', 'grp-platform', 'grp-product', 'grp-contractors')
    )
  `, `
    delete from users
    where email ilike '%@northwind.example'
       or idp_user_id in ('usr-max', 'usr-margaret', 'usr-jenny', 'usr-floyd', 'usr-kristin', 'usr-robert')
  `, `
    delete from identity_groups
    where idp_group_id in ('grp-security', 'grp-platform', 'grp-contractors')
  `, `
    update idp_connections
    set user_count = coalesce(real_users.count, 0),
        group_count = coalesce(real_groups.count, 0),
        last_sync_at = case
          when coalesce(real_users.count, 0) = 0 and coalesce(real_groups.count, 0) = 0 then null
          else last_sync_at
        end,
        last_error = case
          when coalesce(real_users.count, 0) = 0 and coalesce(real_groups.count, 0) = 0 then 'Identity sync has not run with a real provider yet.'
          when last_error = 'Identity sync has not run with a real provider yet.' then null
          else last_error
        end,
        updated_at = now()
    from (
      select c.organization_id, count(u.id)::int as count
      from idp_connections c
      left join users u on u.organization_id = c.organization_id and (
        lower(u.idp_provider) = lower(c.provider)
        or (lower(c.provider) = 'google' and lower(u.idp_provider) = 'googleworkspace')
      )
      group by c.organization_id
    ) real_users,
    (
      select c.organization_id, count(g.id)::int as count
      from idp_connections c
      left join identity_groups g on g.organization_id = c.organization_id and (
        lower(g.idp_provider) = lower(c.provider)
        or (lower(c.provider) = 'google' and lower(g.idp_provider) = 'googleworkspace')
      )
      group by c.organization_id
    ) real_groups
    where idp_connections.organization_id = real_users.organization_id
      and idp_connections.organization_id = real_groups.organization_id
  `, `
    delete from idp_connections
    where user_count = 0
      and group_count = 0
      and last_sync_at is null
      and (
        config = '{}'::jsonb
        or not exists (
          select 1
          from jsonb_each_text(config) as credential(key, value)
          where btrim(coalesce(credential.value, '')) <> ''
        )
      )
  `];
  await auditSection("POST-MIGRATION MAINTENANCE SQL");
  for (const sql of statements) {
    await auditSql("Maintenance statement", sql);
    await pool.query(sql);
  }
  await audit("Dev-token initialization follows when enabled; its application-level operations do not contain schema migration SQL.");
}
