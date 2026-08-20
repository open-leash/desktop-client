import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultAccountPackage,
  deploymentUsesManagedEvaluation,
} from "./account-package.js";

test("Cloud always includes managed Leash AI", () => {
  assert.equal(defaultAccountPackage("individual", "cloud"), "personal-managed");
  assert.equal(defaultAccountPackage("organization", "cloud"), "work-managed");
});

test("Personal Open Source is the only BYOK default", () => {
  assert.equal(defaultAccountPackage("individual", "individual-open-source"), "personal-byok");
  assert.equal(defaultAccountPackage("individual", "private"), "personal-byok");
  assert.equal(defaultAccountPackage("individual", undefined), "personal-byok");
});

test("only an explicitly Cloud-hosted API uses Leash managed evaluation", () => {
  assert.equal(deploymentUsesManagedEvaluation("cloud"), true);
  assert.equal(deploymentUsesManagedEvaluation("CLOUD"), true);
  assert.equal(deploymentUsesManagedEvaluation("private"), false);
  assert.equal(deploymentUsesManagedEvaluation("individual-open-source"), false);
  assert.equal(deploymentUsesManagedEvaluation(undefined), false);
});
