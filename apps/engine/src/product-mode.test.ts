import assert from "node:assert/strict";
import test from "node:test";
import {
  isOrganizationManagedAccount,
  openLeashProductModeFromEnv,
  pluginExecutionAvailable,
  pluginImageDigestRequired,
} from "./product-mode.js";

test("individual open source is user-managed and cannot run cloud-only plugins", () => {
  const mode = openLeashProductModeFromEnv({ OPENLEASH_PRODUCT_MODE: "individual-open-source" });
  assert.equal(isOrganizationManagedAccount(mode, "individual"), false);
  assert.equal(pluginExecutionAvailable(mode, "any"), true);
  assert.equal(pluginExecutionAvailable(mode, "cloud-only"), false);
});

test("Leash Cloud is personal and supports hosted-only Features", () => {
  const mode = openLeashProductModeFromEnv({ OPENLEASH_PRODUCT_MODE: "openleash-cloud" });
  assert.equal(mode.id, "leash-cloud");
  assert.equal(mode.accountScope, "single-user");
  assert.equal(isOrganizationManagedAccount(mode, "individual"), false);
  assert.equal(pluginExecutionAvailable(mode, "cloud-only"), true);
});

test("retired organization mode names cannot enable organization capabilities", () => {
  const mode = openLeashProductModeFromEnv({ OPENLEASH_PRODUCT_MODE: "private-cloud" });
  assert.equal(mode.id, "leash-cloud");
  assert.equal(isOrganizationManagedAccount(mode, "organization"), false);
  assert.equal(mode.capabilities.dashboard, false);
  assert.equal(mode.capabilities.identityProviders, false);
  assert.equal(mode.capabilities.deploymentTokens, false);
});

test("in-process Features never require container image digests", () => {
  const individual = openLeashProductModeFromEnv({
    OPENLEASH_PRODUCT_MODE: "individual-open-source",
  });
  const localPlugin = {
    publisher: "acme",
    source: "private",
    packageUrl: "file:/Users/developer/history-aware",
  };

  assert.equal(pluginImageDigestRequired(individual, localPlugin), false);
  assert.equal(
    pluginImageDigestRequired(individual, {
      ...localPlugin,
      source: "community",
    }),
    false,
  );
  assert.equal(
    pluginImageDigestRequired(individual, {
      ...localPlugin,
      packageUrl: "npm:@acme/history-aware",
    }),
    false,
  );
});
