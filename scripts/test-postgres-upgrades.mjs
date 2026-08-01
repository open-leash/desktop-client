#!/usr/bin/env node
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import process from "node:process";
import { Pool } from "pg";

const baseUrl = process.env.OPENLEASH_UPGRADE_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? "postgres://openleash:openleash@localhost:9543/openleash";
const runId = `${Date.now()}_${process.pid}`;
const composeProject = process.env.OPENLEASH_UPGRADE_COMPOSE_PROJECT
  ?? `openleash-upgrade-${process.pid}`;
let composeStarted = false;
const fixtures = [
  {
    name: "empty-current-install",
    sql: ""
  },
  {
    name: "legacy-org-users",
    sql: `
      create extension if not exists pgcrypto;
      create table organizations (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        slug text unique,
        created_at timestamptz not null default now()
      );
      create table users (
        id uuid primary key default gen_random_uuid(),
        email text unique not null,
        display_name text not null,
        role text not null default 'engineer',
        token_hash text unique,
        created_at timestamptz not null default now()
      );
      insert into organizations (name, slug) values ('Legacy Acme', 'legacy-acme');
      insert into users (email, display_name, role) values ('owner@legacy.example', 'Legacy Owner', 'owner');
    `
  },
  {
    name: "legacy-policy-and-evaluation-columns",
    sql: `
      create extension if not exists pgcrypto;
      create table organizations (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        slug text unique,
        deployment_mode text not null default 'cloud',
        infrastructure_config jsonb not null default '{}'::jsonb,
        setup_completed boolean not null default true,
        current_step integer not null default 6,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table users (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid references organizations(id) on delete cascade,
        email text unique not null,
        display_name text not null,
        role text not null default 'engineer',
        status text not null default 'active',
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create table policies (
        id uuid primary key default gen_random_uuid(),
        name text not null unique,
        description text not null default '',
        severity text not null default 'medium',
        natural_language_rule text not null,
        enabled boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table evaluations (
        id uuid primary key default gen_random_uuid(),
        decision text not null,
        summary text not null,
        created_at timestamptz not null default now()
      );
      insert into organizations (name, slug) values ('Legacy Private', 'legacy-private');
      insert into policies (name, natural_language_rule) values ('Legacy custom policy', 'Ask before doing dangerous legacy things.');
      insert into evaluations (decision, summary) values ('allow', 'legacy evaluation survived');
    `
  }
];

const createdDatabases = [];

try {
  await run("docker", ["compose", "--project-name", composeProject, "up", "-d", "--wait", "postgres"]);
  composeStarted = true;
  for (const fixture of fixtures) {
    await runFixture(fixture);
  }
  console.log("Postgres upgrade fixtures ok");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  for (const database of createdDatabases.reverse()) {
    await dropDatabase(database).catch((error) => {
      console.error(`Could not drop ${database}: ${error.message}`);
    });
  }
  if (composeStarted) {
    await run("docker", ["compose", "--project-name", composeProject, "down", "--remove-orphans"])
      .catch((error) => console.error(`Could not stop ${composeProject}: ${error.message}`));
  }
}

async function runFixture(fixture) {
  const database = `openleash_upgrade_${safeName(fixture.name)}_${runId}`;
  createdDatabases.push(database);
  await createDatabase(database);
  const databaseUrl = databaseUrlFor(database);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    if (fixture.sql.trim()) await pool.query(fixture.sql);
  } finally {
    await pool.end();
  }

  await run("npm", ["run", "db:migrate", "--", "--apply"], {
    DATABASE_URL: databaseUrl,
    OPENLEASH_DEV_TOKEN: ""
  });
  await run("npm", ["run", "db:migrate", "--", "--apply"], {
    DATABASE_URL: databaseUrl,
    OPENLEASH_DEV_TOKEN: ""
  });

  await verifyMigratedDatabase(fixture.name, databaseUrl);
  await run("npm", ["run", "db:create-org", "--", "--name", "Upgrade Private", "--slug", "upgrade-private", "--mode", "private"], {
    DATABASE_URL: databaseUrl
  });
  await run("npm", ["run", "db:create-org", "--", "--name", "Upgrade Cloud", "--slug", "upgrade-cloud", "--mode", "cloud"], {
    DATABASE_URL: databaseUrl
  });
  await verifyMultiTenantData(databaseUrl);
  console.log(`[postgres-upgrade] ${fixture.name} ok`);
}

async function verifyMigratedDatabase(label, databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await expectColumns(pool, "organizations", [
      "id", "name", "slug", "region", "logo_url", "setup_completed", "current_step", "onboarding_code",
      "deployment_mode", "infrastructure_config", "created_at", "updated_at"
    ]);
    await expectColumns(pool, "users", [
      "id", "organization_id", "email", "display_name", "role", "first_name", "last_name", "department",
      "title", "idp_user_id", "idp_provider", "status", "last_login_at", "metadata", "token_hash", "created_at"
    ]);
    await expectColumns(pool, "identity_groups", ["id", "organization_id", "name", "idp_group_id", "idp_provider"]);
    await expectColumns(pool, "evaluations", ["id", "decision", "resolution", "resolution_guidance", "resolved_at", "resolved_by", "summary"]);
    await expectColumns(pool, "plugin_marketplace", ["plugin_id", "runtime", "execution", "execution_environment", "version"]);
    await expectColumns(pool, "plugin_releases", ["id", "plugin_id", "runtime", "execution", "execution_environment", "manifest"]);
    await expectColumns(pool, "plugin_settings", ["organization_id", "plugin_id", "config", "profiles", "installed_version"]);
    await expectColumns(pool, "user_plugin_settings", ["user_id", "organization_id", "plugin_id", "config", "profiles", "installed_version"]);
    const invalidProfileDefaults = await scalar(pool, "select count(*)::int from plugin_settings where jsonb_typeof(profiles) <> 'array'");
    assert(invalidProfileDefaults === 0, `${label}: plugin profile defaults must be JSON arrays`);

    const policyCount = await scalar(pool, "select count(*)::int from policies");
    const expectedPolicyCount = label === "legacy-policy-and-evaluation-columns" ? 1 : 0;
    assert(
      policyCount === expectedPolicyCount,
      `${label}: generated policies must be empty while existing custom policies survive`,
    );
    const openleashOrg = await scalar(pool, "select count(*)::int from organizations where slug = 'openleash'");
    const expectedLegacyOrg = label === "legacy-org-users" ? 1 : 0;
    assert(
      openleashOrg === expectedLegacyOrg,
      `${label}: unused legacy organization seed should be removed`,
    );
    const devOwner = await scalar(pool, "select count(*)::int from users where email = 'max.brin@openleash.local'");
    assert(devOwner === 0, `${label}: legacy development owner should be removed when unused`);
  } finally {
    await pool.end();
  }
}

async function verifyMultiTenantData(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const privateMode = await scalar(pool, "select deployment_mode from organizations where slug = 'upgrade-private'");
    const cloudMode = await scalar(pool, "select deployment_mode from organizations where slug = 'upgrade-cloud'");
    assert(privateMode === "private", "upgrade-private should be private");
    assert(cloudMode === "cloud", "upgrade-cloud should be cloud");
  } finally {
    await pool.end();
  }
}

async function expectColumns(pool, table, expected) {
  const result = await pool.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  for (const column of expected) {
    assert(columns.has(column), `${table} missing column ${column}`);
  }
}

async function scalar(pool, sql) {
  const result = await pool.query(sql);
  return Object.values(result.rows[0] ?? {})[0];
}

async function createDatabase(database) {
  await withMaintenancePool(async (pool) => {
    await pool.query(`create database ${quoteIdent(database)}`);
  });
}

async function dropDatabase(database) {
  await withMaintenancePool(async (pool) => {
    await pool.query(`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()
    `, [database]);
    await pool.query(`drop database if exists ${quoteIdent(database)}`);
  });
}

async function withMaintenancePool(fn) {
  const pool = new Pool({ connectionString: databaseUrlFor("postgres") });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

function databaseUrlFor(database) {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32)
    || crypto.randomBytes(4).toString("hex");
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit"
    });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)));
    child.on("error", reject);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
