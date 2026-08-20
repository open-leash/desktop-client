import assert from "node:assert/strict";
import test from "node:test";
import {
  canUserConfigurePlugin,
  canUserInstallPlugin,
  canUserUninstallPlugin,
  normalizeOrganizationPluginPolicy,
  pluginEnabledForUser,
  pluginProvidedByOrganization,
} from "./plugin-policy.js";

test("mandatory installation is independent from employee configuration freedom", () => {
  const policy = normalizeOrganizationPluginPolicy({
    mandatory: true,
    configLocked: false,
    userInstallAllowed: true,
  });
  assert.deepEqual(policy, {
    mandatory: true,
    defaultEnabled: true,
    userInstallAllowed: true,
    configLocked: false,
  });
  assert.equal(pluginEnabledForUser({ policy, userSettings: { enabled: false } }), true);
  assert.equal(canUserConfigurePlugin({ enabled: true, policy }), true);
  assert.equal(canUserUninstallPlugin(policy), false);
});

test("locked organization configuration remains mandatory while ignoring user disable and edits", () => {
  const policy = normalizeOrganizationPluginPolicy({ mandatory: true, configLocked: true });
  assert.equal(pluginEnabledForUser({ policy, userSettings: { enabled: false } }), true);
  assert.equal(canUserConfigurePlugin({ enabled: true, policy }), false);
  assert.equal(canUserUninstallPlugin(policy), false);
});

test("blocking marketplace installs does not block configuration or removal of an existing plugin", () => {
  const policy = normalizeOrganizationPluginPolicy({ userInstallAllowed: false, configLocked: false });
  assert.equal(canUserInstallPlugin({
    policy,
    allowUserMarketplaceInstalls: false,
    allowUserCommunityPlugins: false,
    firstParty: true,
  }), false);
  assert.equal(canUserConfigurePlugin({ enabled: true, policy }), true);
  assert.equal(canUserUninstallPlugin(policy), true);
});

test("organization defaults can be customized and re-enabled without marketplace permission", () => {
  const policy = normalizeOrganizationPluginPolicy({
    defaultEnabled: true,
    userInstallAllowed: false,
    configLocked: false,
  });
  const providedByOrganization = pluginProvidedByOrganization({ policy });
  assert.equal(providedByOrganization, true);
  assert.equal(canUserInstallPlugin({
    policy,
    allowUserMarketplaceInstalls: false,
    allowUserCommunityPlugins: false,
    firstParty: false,
    providedByOrganization,
  }), true);
  assert.equal(pluginEnabledForUser({ policy, userSettings: { enabled: false } }), false);
});

test("solo modes retain user control when no organization policy is configured", () => {
  assert.equal(canUserInstallPlugin({
    allowUserMarketplaceInstalls: true,
    allowUserCommunityPlugins: true,
    firstParty: false,
  }), true);
  assert.equal(canUserConfigurePlugin({ enabled: true }), true);
  assert.equal(canUserUninstallPlugin(), true);
});
