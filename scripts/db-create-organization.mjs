#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { Pool } from "pg";

const args = parseArgs(process.argv.slice(2));
const name = String(args.name ?? args._[0] ?? "").trim();
const slug = slugify(String(args.slug ?? args._[1] ?? name));
const region = String(args.region ?? "").trim() || null;
const deploymentMode = normalizeDeploymentMode(String(args.deploymentMode ?? args.mode ?? "cloud"));
const setupCompleted = args.setupCompleted === false ? false : true;
const currentStep = Number(args.currentStep ?? (setupCompleted ? 6 : 1));
const replaceExisting = args.replaceExisting === true;

if (!name || !slug) {
  console.error(`Usage:
  npm run db:create-org -- --name "Acme Corp" --slug acme
  npm run db:create-org -- "Acme Corp" acme

Options:
  --region <region>
  --mode <cloud|private|self-hosted>
  --setup-completed false
  --current-step <number>
  --replace-existing  Overwrite an existing organization's profile and onboarding state`);
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl() });

try {
  const conflictUpdate = replaceExisting
    ? `name = excluded.name,
       region = excluded.region,
       setup_completed = excluded.setup_completed,
       current_step = excluded.current_step,
       deployment_mode = excluded.deployment_mode,
       updated_at = now()`
    : `deployment_mode = excluded.deployment_mode,
       updated_at = now()`;
  const result = await pool.query(
    `insert into organizations (name, slug, region, setup_completed, current_step, deployment_mode, infrastructure_config)
     values ($1, $2, $3, $4, $5, $6, '{}'::jsonb)
     on conflict (slug) do update set
       ${conflictUpdate}
     returning id, name, slug, region, setup_completed, current_step, deployment_mode, created_at, updated_at`,
    [name, slug, region, setupCompleted, currentStep, deploymentMode]
  );
  const organization = result.rows[0];
  console.log(JSON.stringify({ ok: true, organization }, null, 2));
  console.log(`Dashboard: http://localhost:9300/${organization.slug}`);
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
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
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

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeDeploymentMode(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "private" || normalized === "self-hosted" || normalized === "cloud") return normalized;
  return "cloud";
}
