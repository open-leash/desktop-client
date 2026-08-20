export type PluginPolicyState = {
  mandatory: boolean;
  defaultEnabled: boolean;
  userInstallAllowed: boolean;
  configLocked: boolean;
};

export type PluginSettingPresence = {
  enabled?: boolean;
};

export function normalizeOrganizationPluginPolicy(
  body: Record<string, unknown>,
  current?: Partial<PluginPolicyState>,
): PluginPolicyState {
  const mandatory = booleanValue(body.mandatory, current?.mandatory ?? false);
  return {
    mandatory,
    defaultEnabled: mandatory || booleanValue(body.defaultEnabled, current?.defaultEnabled ?? false),
    userInstallAllowed: booleanValue(body.userInstallAllowed, current?.userInstallAllowed ?? true),
    configLocked: booleanValue(body.configLocked, current?.configLocked ?? false),
  };
}

export function pluginEnabledForUser(input: {
  policy?: Partial<PluginPolicyState>;
  organizationSettings?: PluginSettingPresence;
  userSettings?: PluginSettingPresence;
}) {
  if (input.policy?.mandatory) return true;
  return input.userSettings?.enabled ??
    input.organizationSettings?.enabled ??
    input.policy?.defaultEnabled ??
    false;
}

export function pluginProvidedByOrganization(input: {
  policy?: Partial<PluginPolicyState>;
  organizationSettings?: PluginSettingPresence;
}) {
  return Boolean(
    input.policy?.mandatory ||
    input.policy?.defaultEnabled ||
    input.organizationSettings?.enabled,
  );
}

export function canUserInstallPlugin(input: {
  policy?: Partial<PluginPolicyState>;
  allowUserMarketplaceInstalls: boolean;
  allowUserCommunityPlugins: boolean;
  firstParty: boolean;
  providedByOrganization?: boolean;
}) {
  if (input.policy?.mandatory || input.providedByOrganization) return true;
  if (input.policy?.userInstallAllowed === false) return false;
  if (!input.allowUserMarketplaceInstalls) return false;
  return input.firstParty || input.allowUserCommunityPlugins;
}

export function canUserConfigurePlugin(input: {
  enabled: boolean;
  policy?: Partial<PluginPolicyState>;
}) {
  return input.enabled && input.policy?.configLocked !== true;
}

export function canUserUninstallPlugin(policy?: Partial<PluginPolicyState>) {
  return policy?.mandatory !== true;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
