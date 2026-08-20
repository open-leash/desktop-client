export type AccountPackage = "personal-byok" | "personal-managed" | "work-managed";

export function defaultAccountPackage(
  audience: "individual" | "organization",
  deploymentMode: unknown,
): AccountPackage {
  if (audience === "organization") return "work-managed";
  return String(deploymentMode ?? "").trim().toLowerCase() === "cloud"
    ? "personal-managed"
    : "personal-byok";
}

export function deploymentUsesManagedEvaluation(deploymentMode: unknown) {
  return String(deploymentMode ?? "").trim().toLowerCase() === "cloud";
}
