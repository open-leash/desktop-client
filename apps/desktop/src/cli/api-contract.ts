export type OpenLeashApiFunction =
  | "health"
  | "tenantEnroll"
  | "tenantPluginsRead"
  | "adminPluginsWrite"
  | "localHookEvaluate";

const contracts: Record<OpenLeashApiFunction, string> = {
  health: "2026-05-16.health.v1",
  tenantEnroll: "2026-05-16.tenant-enroll.v1",
  tenantPluginsRead: "2026-06-20.tenant-plugins-read.v1",
  adminPluginsWrite: "2026-06-20.admin-plugins-write.v1",
  localHookEvaluate: "2026-05-22.local-hook-evaluate.v1"
};

export function apiVersionHeaders(functionName: OpenLeashApiFunction) {
  return {
    "x-openleash-api-function": functionName,
    "x-openleash-api-version": contracts[functionName]
  };
}
