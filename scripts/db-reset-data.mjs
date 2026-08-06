#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { Pool } from "pg";

const args = parseArgs(process.argv.slice(2));
const includePolicies = Boolean(args.includePolicies || args.all);
const yes = Boolean(args.yes || args.force);

if (!yes) {
  console.error(`This will remove Leash tenant/runtime data from the local database.

Run with:
  npm run db:reset-data -- --yes

By default this preserves the default policies table.
For a full wipe including policies:
  npm run db:reset-data -- --yes --include-policies`);
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl() });

try {
  const tablesResult = await pool.query(
    `select tablename
     from pg_tables
     where schemaname = 'public'
       and ($1::boolean or tablename <> 'policies')
     order by tablename`,
    [includePolicies]
  );
  const tables = tablesResult.rows.map((row) => row.tablename);
  if (tables.length === 0) {
    console.log(JSON.stringify({ ok: true, truncated: [] }, null, 2));
    process.exit(0);
  }

  const tableList = tables.map((table) => `public.${quoteIdentifier(table)}`).join(", ");
  await pool.query(`truncate table ${tableList} restart identity cascade`);

  console.log(JSON.stringify({ ok: true, truncated: tables, preserved: includePolicies ? [] : ["policies"] }, null, 2));
  if (includePolicies) {
    console.log("Default policies were removed too. Run `npm run db:migrate -- --apply` to reseed schema defaults.");
  }
} finally {
  await pool.end();
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(".env", "utf8");
    const match = env.match(/^DATABASE_URL=(.*)$/m);
    if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, "");
  } catch {
    // Fall back to the local docker-compose default below.
  }
  return "postgres://openleash:openleash@localhost:9543/openleash";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      parsed[key] = parseValue(inlineValue);
    } else if (next && !next.startsWith("--")) {
      parsed[key] = parseValue(next);
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
