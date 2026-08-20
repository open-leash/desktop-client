import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "./db.js";
import {
  configureRuntimePolicyProvider,
  effectiveRuntimeDecision,
  runtimePolicyForUser,
} from "./runtime-policy.js";

const denied = {
  decision: "deny" as const,
  decisionId: "decision-1",
  summary: "Sensitive action detected.",
  results: [],
};

test.afterEach(() => configureRuntimePolicyProvider(undefined));

test("runtime policy defaults to enforcement and employee notifications", async () => {
  assert.deepEqual(await runtimePolicyForUser({ id: "user-1" }), {
    enforcementMode: "enforce",
    notifyEmployees: true,
  });
});

test("learning mode allows execution while retaining the observed decision", async (context) => {
  const query = context.mock.method(pool, "query", async () => ({ rows: [], rowCount: 1 }));
  configureRuntimePolicyProvider(async () => ({
    enforcementMode: "learning",
    notifyEmployees: false,
  }));

  const effective = await effectiveRuntimeDecision({ id: "user-1" }, denied);
  assert.equal(effective.decision, "allow");
  assert.equal(effective.observedDecision, "deny");
  assert.equal(effective.runtimePolicy?.enforcementMode, "learning");
  assert.equal(effective.runtimePolicy?.notifyEmployees, false);
  assert.match(effective.summary, /^Learning only:/);
  assert.equal(query.mock.callCount(), 1);
  assert.match(String(query.mock.calls[0]?.arguments[0]), /resolved_by = 'organization-learning-mode'/);
});

test("enforcement mode preserves a denied response", async () => {
  configureRuntimePolicyProvider(() => ({
    enforcementMode: "enforce",
    notifyEmployees: false,
  }));

  const effective = await effectiveRuntimeDecision({ id: "user-1" }, denied);
  assert.equal(effective.decision, "deny");
  assert.equal(effective.observedDecision, undefined);
  assert.equal(effective.runtimePolicy?.notifyEmployees, false);
});
