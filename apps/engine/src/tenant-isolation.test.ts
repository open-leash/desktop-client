import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard sessions are bound to the user's current organization", async () => {
  const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  const sessionQuery = source.slice(source.indexOf("async function getDashboardSession"), source.indexOf("async function getClientOrDashboardSession"));
  assert.match(sessionQuery, /ds\.organization_id = u\.organization_id/);
  assert.match(sessionQuery, /u\.status = 'active'/);
});

test("client tokens reject disabled users and stale tenant sessions", async () => {
  const source = await readFile(new URL("./db.ts", import.meta.url), "utf8");
  assert.match(source, /token_hash = \$1 and status = 'active'/);
  assert.match(source, /ds\.organization_id = u\.organization_id/);
  assert.match(source, /u\.status = 'active'/);
});

test("only organization administrators receive organization-wide dashboard scope", async () => {
  const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  const roleGuard = source.slice(source.indexOf("function isDashboardAccessRole"), source.indexOf("function isAllowedCorsOrigin"));
  for (const role of ["owner", "admin", "ciso", "cio", "security_admin"]) assert.match(roleGuard, new RegExp(`\"${role}\"`));
  for (const role of ["analyst", "responder", "viewer", "engineer"]) assert.doesNotMatch(roleGuard, new RegExp(`\"${role}\"`));
});
