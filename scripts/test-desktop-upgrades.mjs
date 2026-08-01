#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import localServerModule from "../apps/desktop-client/src/local-server.ts";

const { LocalOpenLeashServer } = localServerModule;

const fixtures = [
  {
    name: "fresh-backend-cache",
    setup(dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
  },
  {
    name: "legacy-json-store",
    setup(dir) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "personal-store.json"), JSON.stringify({
        token: "legacy-json-token",
        setupComplete: true,
        clientMode: "personal",
        apiProvider: "openai",
        apiKey: "legacy-key",
        policies: [{
          id: "legacy-policy",
          name: "Legacy policy",
          category: "Legacy",
          description: "Imported from the old JSON store.",
          enabled: true,
          match: ["legacy"]
        }],
        history: [{
          id: "legacy-eval",
          decision: "allow",
          summary: "Legacy evaluation",
          created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
          user_name: "legacy-user",
          hostname: "legacy-host",
          agent_name: "Claude Code",
          agent_kind: "claude-code",
          event_name: "PreToolUse",
          payload: {
            eventName: "PreToolUse",
            agentKind: "claude-code",
            sessionId: "legacy-session",
            occurredAt: new Date("2026-01-01T00:00:00.000Z").toISOString()
          },
          triggered_policies: []
        }]
      }, null, 2));
    }
  },
  {
    name: "legacy-sqlite-schema",
    setup(dir) {
      fs.mkdirSync(dir, { recursive: true });
      const db = new Database(path.join(dir, "personal.sqlite"));
      try {
        db.exec(`
          create table settings (key text primary key, value text);
          create table policies (
            id text primary key,
            name text not null,
            category text not null,
            description text not null,
            enabled integer not null default 1,
            match_json text,
            pattern text,
            sort_order integer not null default 0
          );
          create table evaluations (
            id text primary key,
            fingerprint text,
            decision text not null,
            summary text not null,
            question text,
            created_at text not null,
            resolved_at text,
            user_name text not null,
            hostname text not null,
            agent_name text not null,
            agent_kind text not null,
            event_name text not null,
            tool_name text,
            project_path text,
            payload_json text not null,
            triggered_policies_json text not null
          );
          insert into settings (key, value) values
            ('token', 'legacy-sqlite-token'),
            ('setupComplete', 'true'),
            ('clientMode', 'personal'),
            ('apiProvider', 'openai'),
            ('apiKey', 'legacy-key'),
            ('promptTransforms', '{}'),
            ('jsonMigrated', 'true');
          insert into policies (id, name, category, description, enabled, match_json, sort_order)
            values ('legacy-policy', 'Legacy policy', 'Legacy', 'Old SQLite policy', 1, '["legacy"]', 0);
          insert into evaluations (
            id, fingerprint, decision, summary, question, created_at, resolved_at,
            user_name, hostname, agent_name, agent_kind, event_name, tool_name, project_path,
            payload_json, triggered_policies_json
          ) values (
            'legacy-eval', 'legacy-fingerprint', 'allow', 'Legacy evaluation', null, '2026-01-01T00:00:00.000Z', null,
            'legacy-user', 'legacy-host', 'Claude Code', 'claude-code', 'PreToolUse', 'Read', '/tmp/legacy',
            '{"eventName":"PreToolUse","agentKind":"claude-code","sessionId":"legacy","occurredAt":"2026-01-01T00:00:00.000Z"}',
            '[]'
          );
        `);
      } finally {
        db.close();
      }
    }
  }
];

const roots = [];

try {
  for (const fixture of fixtures) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `openleash-desktop-upgrade-${fixture.name}-`));
    roots.push(dir);
    fixture.setup(dir);
    const server = new LocalOpenLeashServer(dir);
    await verifyServer(fixture.name, server);
    verifySqliteShape(fixture.name, path.join(dir, "personal.sqlite"));
    console.log(`[desktop-upgrade] ${fixture.name} ok`);
  }
  console.log("Desktop local cache upgrade fixtures ok");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  for (const dir of roots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyServer(label, server) {
  assert(server.token, `${label}: token should be available`);
  assert(Array.isArray(server.policies), `${label}: policies should be readable`);
  if (label === "fresh-backend-cache") {
    assert(server.policies.length === 0, `${label}: generated policies should start empty`);
  } else {
    assert(server.policies.length >= 1, `${label}: existing custom policies should survive`);
  }
  assert(server.promptTransforms?.compression, `${label}: prompt transform defaults should exist`);
}

function verifySqliteShape(label, dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    expectColumns(db, "settings", ["key", "value"]);
    expectColumns(db, "policies", ["id", "name", "category", "description", "enabled", "locked", "match_json", "pattern", "sort_order"]);
    expectColumns(db, "evaluations", [
      "id", "fingerprint", "intent_key", "file_path", "decision", "resolution", "resolution_guidance",
      "resolution_payload_json", "summary", "question", "created_at", "resolved_at", "user_name", "hostname", "agent_name",
      "agent_kind", "event_name", "tool_name", "project_path", "payload_json", "triggered_policies_json"
    ]);
    expectColumns(db, "mcp_servers", ["id", "server_name", "first_seen_at", "last_seen_at", "tool_count", "call_count", "metadata_json"]);
    expectColumns(db, "mcp_tool_calls", ["id", "mcp_server_id", "evaluation_id", "server_name", "tool_name", "full_tool_name"]);
    expectColumns(db, "skills", ["id", "agent_kind", "scope", "skill_path", "status", "content", "content_preview", "purpose_summary"]);
    const migrations = new Map(
      db.prepare("select id, checksum from schema_migrations order by id").all().map((row) => [row.id, row.checksum]),
    );
    assert(
      migrations.get("0002_agent_interaction_responses") ===
        "evaluations-resolution-payload-json-v1",
      `${label}: structured-response migration was not recorded`,
    );
  } finally {
    db.close();
  }
}

function expectColumns(db, table, expected) {
  const columns = new Set(db.prepare(`pragma table_info(${table})`).all().map((row) => row.name));
  for (const column of expected) {
    assert(columns.has(column), `${table} missing column ${column}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
