export type OpenLeashApiFunction = "health" | "tenantEnroll" | "localHookEvaluate";

const contracts: Record<OpenLeashApiFunction, string> = {
  health: "2026-05-16.health.v1",
  tenantEnroll: "2026-05-16.tenant-enroll.v1",
  localHookEvaluate: "2026-05-22.local-hook-evaluate.v1"
};

export function apiVersionHeaders(functionName: OpenLeashApiFunction) {
  return {
    "x-openleash-api-function": functionName,
    "x-openleash-api-version": contracts[functionName]
  };
}
