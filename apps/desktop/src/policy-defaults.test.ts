import assert from "node:assert/strict";
import test from "node:test";
import { migrateDefaultPolicies } from "./local-server.js";

test("removes generated starter rules while preserving user rules", () => {
  const migrated = migrateDefaultPolicies([
    {
      id: "filesystem-destruction",
      name: "Filesystem destruction",
      category: "Local destruction",
      description: "Generated starter rule",
      enabled: true,
    },
    {
      id: "team-change-ticket",
      name: "Require a change ticket",
      category: "Imported instructions",
      description: "Ask for a change ticket before production changes.",
      enabled: true,
    },
  ]);

  assert.deepEqual(migrated.map((policy) => policy.id), ["team-change-ticket"]);
});
