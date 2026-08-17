#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { Pool } from "pg";
import { startIsolatedPostgres } from "./postgres-test-container.mjs";

let baseUrl;
const database = `openleash_cloud_upgrade_${Date.now()}_${process.pid}`;
let postgres;

try {
  postgres = await startIsolatedPostgres("openleash-cloud-upgrade");
  baseUrl = postgres.databaseUrl;
  await withDatabase("postgres", async (pool) => pool.query(`create database ${quoteIdent(database)}`));
  const databaseUrl = databaseUrlFor(database);

  await run("npm", ["run", "db:migrate", "-w", "@openleash/client-api", "--", "--apply"], { DATABASE_URL: databaseUrl });
  await run("npm", ["run", "db:migrate", "-w", "@openleash/client-api", "--", "--apply"], { DATABASE_URL: databaseUrl });
  await run("npx", ["tsx", "src/migrate.ts", "--apply"], { DATABASE_URL: databaseUrl }, "apps/cloud-client-api");
  await run("npx", ["tsx", "src/migrate.ts", "--apply"], { DATABASE_URL: databaseUrl }, "apps/cloud-client-api");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const core = await scalar(pool, "select count(*)::int from schema_migrations");
    const cloud = await scalar(pool, "select count(*)::int from cloud_schema_migrations");
    if (core < 1 || cloud < 1) throw new Error(`Migration ledgers are incomplete: core=${core}, cloud=${cloud}`);
    for (const table of ["cloud_tenants", "cloud_billing_accounts", "organization_siem_settings"]) {
      const exists = await scalar(pool, "select to_regclass($1) is not null", [table]);
      if (!exists) throw new Error(`Cloud migration is missing ${table}`);
    }
  } finally {
    await pool.end();
  }
  console.log("Cloud Postgres empty-install and idempotent upgrade fixtures ok");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  if (postgres) {
    await withDatabase("postgres", async (pool) => {
      await pool.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [database]);
      await pool.query(`drop database if exists ${quoteIdent(database)}`);
    }).catch((error) => console.error(`Could not drop ${database}: ${error.message}`));
    await postgres.stop().catch((error) => console.error(`Could not stop ${postgres.name}: ${error.message}`));
  }
}

async function withDatabase(name, action) {
  const pool = new Pool({ connectionString: databaseUrlFor(name) });
  try { return await action(pool); } finally { await pool.end(); }
}

function databaseUrlFor(name) {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function scalar(pool, sql, parameters = []) {
  return pool.query(sql, parameters).then((result) => Object.values(result.rows[0] ?? {})[0]);
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function run(command, args, env = {}, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)));
    child.on("error", reject);
  });
}
