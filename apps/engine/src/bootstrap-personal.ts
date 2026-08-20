import fs from "node:fs";
import process from "node:process";
import { Pool } from "pg";

type ParsedArgs = Record<string, string | boolean | string[]> & { _: string[] };

const args = parseArgs(process.argv.slice(2));
const name = String(args.name ?? args._[0] ?? "Personal Leash").trim();
const slug = slugify(String(args.slug ?? args._[1] ?? "personal"));
const deploymentMode = String(args.mode ?? "private") === "cloud" ? "cloud" : "private";

const pool = new Pool({ connectionString: databaseUrl() });
try {
  // The organizations table name is retained only as a database compatibility
  // boundary. Every public Leash install bootstraps exactly one personal owner.
  const result = await pool.query(
    `insert into organizations (name, slug, region, setup_completed, current_step, deployment_mode, infrastructure_config)
     values ($1, $2, null, true, 6, $3, '{}'::jsonb)
     on conflict (slug) do update set
       name = excluded.name,
       setup_completed = true,
       current_step = 6,
       deployment_mode = excluded.deployment_mode,
       updated_at = now()
     returning id, name, slug, deployment_mode, created_at, updated_at`,
    [name, slug, deploymentMode],
  );
  console.log(JSON.stringify({ ok: true, personalProfile: result.rows[0] }, null, 2));
} finally {
  await pool.end();
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const match = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m);
    if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, "");
  } catch {
    // Use the local development default.
  }
  return "postgres://openleash:openleash@localhost:9543/openleash";
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
    const next = argv[index + 1];
    if (inlineValue !== undefined) parsed[key] = parseValue(inlineValue);
    else if (next && !next.startsWith("--")) {
      parsed[key] = parseValue(next);
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}

function parseValue(value: string): string | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}
