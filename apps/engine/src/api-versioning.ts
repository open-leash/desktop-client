import {
  OPENLEASH_API_CONTRACTS,
  type OpenLeashApiFunction,
} from "@openleash/shared";

export const OPENLEASH_API_NEGOTIATED_VERSION_HEADER =
  "x-openleash-api-negotiated-version";
export const OPENLEASH_API_COMPATIBILITY_HEADER =
  "x-openleash-api-compatibility";

type ParsedContractVersion = {
  date: string;
  contract: string;
  major: number;
};

export function negotiateApiContractVersion(
  functionName: OpenLeashApiFunction,
  requestedVersion?: string,
) {
  const currentVersion = OPENLEASH_API_CONTRACTS[functionName];
  if (!requestedVersion) {
    return {
      compatible: true,
      currentVersion,
      negotiatedVersion: currentVersion,
      mode: "legacy-headerless" as const,
    };
  }
  if (requestedVersion === currentVersion) {
    return {
      compatible: true,
      currentVersion,
      negotiatedVersion: currentVersion,
      mode: "current" as const,
    };
  }

  const requested = parseContractVersion(requestedVersion);
  const current = parseContractVersion(currentVersion);
  const compatible = Boolean(
    requested &&
      current &&
      requested.contract === current.contract &&
      requested.major === current.major &&
      requested.date <= current.date,
  );
  return {
    compatible,
    currentVersion,
    negotiatedVersion: compatible ? requestedVersion : currentVersion,
    mode: compatible ? ("backward-compatible" as const) : ("unsupported" as const),
  };
}

export function acceptsLegacyHookContract(
  functionName: OpenLeashApiFunction,
  requestPath: string,
  requestedVersion?: string,
) {
  return Boolean(
    functionName === "tenantHookEvaluate" &&
      /^\/v1\/hooks\/[^/]+\/[^/]+$/.test(requestPath) &&
      requestedVersion === OPENLEASH_API_CONTRACTS.localHookEvaluate,
  );
}

function parseContractVersion(value: string): ParsedContractVersion | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})\.([a-z0-9-]+)\.v(\d+)$/i.exec(
    value,
  );
  if (!match) return undefined;
  return {
    date: match[1],
    contract: match[2].toLowerCase(),
    major: Number(match[3]),
  };
}
