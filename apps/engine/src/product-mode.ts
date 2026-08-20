export type OpenLeashProductModeId = "individual-open-source" | "leash-cloud";

export type OpenLeashCapability =
  | "singleUserRuntime"
  | "clientRuntime"
  | "pluginRuntime"
  | "publicPluginCatalog"
  | "desktopUpdates"
  | "orgManagement"
  | "dashboard"
  | "identityProviders"
  | "deploymentTokens"
  | "fleetVisibility"
  | "cloudTenancy"
  | "billing";

export type OpenLeashProductMode = {
  id: OpenLeashProductModeId;
  label: string;
  accountScope: "single-user" | "organization" | "multi-tenant";
  capabilities: Record<OpenLeashCapability, boolean>;
};

const coreCapabilities = {
  singleUserRuntime: true,
  clientRuntime: true,
  pluginRuntime: true,
  publicPluginCatalog: false,
  desktopUpdates: true
} satisfies Partial<Record<OpenLeashCapability, boolean>>;

const disabledOrgCapabilities = {
  orgManagement: false,
  dashboard: false,
  identityProviders: false,
  deploymentTokens: false,
  fleetVisibility: false,
  cloudTenancy: false,
  billing: false
} satisfies Partial<Record<OpenLeashCapability, boolean>>;

export function openLeashProductModeFromEnv(env: NodeJS.ProcessEnv = process.env): OpenLeashProductMode {
  const raw = String(env.OPENLEASH_PRODUCT_MODE ?? env.OPENLEASH_DEPLOYMENT_MODE ?? env.OPENLEASH_CLIENT_MODE ?? "openleash-cloud").toLowerCase();
  if (raw.includes("individual") || raw.includes("open-source") || raw.includes("opensource") || raw.includes("community") || raw.includes("personal")) {
    return {
      id: "individual-open-source",
      label: "Personal Open Source",
      accountScope: "single-user",
      capabilities: capabilities({
        ...coreCapabilities,
        ...disabledOrgCapabilities,
        singleUserRuntime: true
      })
    };
  }
  return {
    id: "leash-cloud",
    label: "Leash Cloud",
    accountScope: "single-user",
    capabilities: capabilities({
      ...coreCapabilities,
      ...disabledOrgCapabilities,
      singleUserRuntime: true,
      cloudTenancy: true,
      billing: true
    })
  };
}

export function hasCapability(mode: OpenLeashProductMode, capability: OpenLeashCapability) {
  return mode.capabilities[capability] === true;
}

export function publicProductMode(mode: OpenLeashProductMode) {
  return {
    id: mode.id,
    label: mode.label,
    accountScope: mode.accountScope,
    capabilities: mode.capabilities
  };
}

export function isOrganizationManagedAccount(
  _mode: OpenLeashProductMode,
  _audience: string | undefined,
) {
  return false;
}

export function pluginExecutionAvailable(
  mode: OpenLeashProductMode,
  executionEnvironment: "any" | "cloud-only" | undefined,
) {
  return executionEnvironment !== "cloud-only" || mode.id === "leash-cloud";
}

export function pluginImageDigestRequired(
  _mode: OpenLeashProductMode,
  _plugin: {
    publisher?: string;
    source?: string;
    packageUrl?: string;
  },
) {
  return false;
}

function capabilities(partial: Partial<Record<OpenLeashCapability, boolean>>): Record<OpenLeashCapability, boolean> {
  return {
    singleUserRuntime: false,
    clientRuntime: false,
    pluginRuntime: false,
    publicPluginCatalog: false,
    desktopUpdates: false,
    orgManagement: false,
    dashboard: false,
    identityProviders: false,
    deploymentTokens: false,
    fleetVisibility: false,
    cloudTenancy: false,
    billing: false,
    ...partial
  };
}
