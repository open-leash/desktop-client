import type { BusinessRuntimePolicy, EvaluationResponse } from "@openleash/shared";
import { pool } from "./db.js";

export type RuntimePolicyUser = {
  id: string;
  organization_id?: string | null;
};

export type RuntimePolicyProvider = (
  user: RuntimePolicyUser,
) => BusinessRuntimePolicy | undefined | Promise<BusinessRuntimePolicy | undefined>;

const DEFAULT_RUNTIME_POLICY: BusinessRuntimePolicy = {
  enforcementMode: "enforce",
  notifyEmployees: true,
};

let runtimePolicyProvider: RuntimePolicyProvider | undefined;

export function configureRuntimePolicyProvider(provider?: RuntimePolicyProvider) {
  runtimePolicyProvider = provider;
}

export async function runtimePolicyForUser(
  user: RuntimePolicyUser,
): Promise<BusinessRuntimePolicy> {
  if (!runtimePolicyProvider) return DEFAULT_RUNTIME_POLICY;
  try {
    return normalizeRuntimePolicy(await runtimePolicyProvider(user));
  } catch (error) {
    console.warn("runtime policy provider failed; using enforcement defaults", error);
    return DEFAULT_RUNTIME_POLICY;
  }
}

export async function effectiveRuntimeDecision(
  user: RuntimePolicyUser,
  response: EvaluationResponse,
): Promise<EvaluationResponse> {
  const policy = await runtimePolicyForUser(user);
  if (policy.enforcementMode !== "learning" || response.decision === "allow") {
    return { ...response, runtimePolicy: policy };
  }

  await pool.query(
    `update evaluations
     set resolution = 'allow',
         resolution_guidance = 'Allowed automatically by Business learning-only mode.',
         resolved_by = 'organization-learning-mode',
         resolved_at = coalesce(resolved_at, now())
     where id = $1 and user_id = $2 and resolution is null`,
    [response.decisionId, user.id],
  );

  return {
    ...response,
    decision: "allow",
    observedDecision: response.decision,
    runtimePolicy: policy,
    summary: `Learning only: ${response.summary}`,
    question: undefined,
  };
}

function normalizeRuntimePolicy(
  policy: BusinessRuntimePolicy | undefined,
): BusinessRuntimePolicy {
  return {
    enforcementMode: policy?.enforcementMode === "learning" ? "learning" : "enforce",
    notifyEmployees: policy?.notifyEmployees !== false,
    ...(policy?.updatedAt ? { updatedAt: policy.updatedAt } : {}),
  };
}
