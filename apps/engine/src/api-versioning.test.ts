import assert from "node:assert/strict";
import test from "node:test";
import { OPENLEASH_API_CONTRACTS } from "@openleash/shared";
import {
  acceptsLegacyHookContract,
  negotiateApiContractVersion,
} from "./api-versioning.js";

test("headerless installed clients remain supported", () => {
  const result = negotiateApiContractVersion("clientUpdateCheck");
  assert.equal(result.compatible, true);
  assert.equal(result.mode, "legacy-headerless");
});

test("the current contract is negotiated exactly", () => {
  const current = OPENLEASH_API_CONTRACTS.clientUpdateCheck;
  const result = negotiateApiContractVersion("clientUpdateCheck", current);
  assert.equal(result.compatible, true);
  assert.equal(result.negotiatedVersion, current);
  assert.equal(result.mode, "current");
});

test("older v1 contracts remain compatible with additive server changes", () => {
  const result = negotiateApiContractVersion(
    "clientUpdateCheck",
    "2026-04-01.client-update-check.v1",
  );
  assert.equal(result.compatible, true);
  assert.equal(result.mode, "backward-compatible");
});

test("a contract for another API function is rejected", () => {
  const result = negotiateApiContractVersion(
    "clientUpdateCheck",
    OPENLEASH_API_CONTRACTS.mobileState,
  );
  assert.equal(result.compatible, false);
});

test("future and breaking contract versions require a new server adapter", () => {
  assert.equal(
    negotiateApiContractVersion(
      "clientUpdateCheck",
      "2099-01-01.client-update-check.v1",
    ).compatible,
    false,
  );
  assert.equal(
    negotiateApiContractVersion(
      "clientUpdateCheck",
      "2026-05-16.client-update-check.v2",
    ).compatible,
    false,
  );
});

test("released local hook contracts remain valid against cloud hook routes", () => {
  assert.equal(
    acceptsLegacyHookContract(
      "tenantHookEvaluate",
      "/v1/hooks/claude/UserPromptSubmit",
      OPENLEASH_API_CONTRACTS.localHookEvaluate,
    ),
    true,
  );
});
