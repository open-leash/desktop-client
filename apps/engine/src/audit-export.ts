import type {
  EvaluationRequest,
  PipelineEvent,
  PluginLogRecord,
  PluginRunRecord,
  PolicyDecision,
} from "@openleash/shared";

export type AuditExportSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type AuditExportResult = {
  status: "queued" | "delivered" | "skipped" | "failed";
  summary: string;
  metadata?: Record<string, unknown>;
};

export type AuditDecisionExport = {
  request: EvaluationRequest;
  event: PipelineEvent;
  decision: "allow" | "ask" | "deny";
  summary: string;
  evaluationId?: string;
  conversationEventId: string;
  organization: { id: string; name?: string; slug?: string | null };
  user: { id: string; email?: string; displayName?: string };
  computerId?: string;
  runtimeId?: string;
  policyResults?: PolicyDecision[];
  featureRuns?: PluginRunRecord[];
  featureLogs?: PluginLogRecord[];
};

export type AuditLogExport = {
  log: PluginLogRecord;
  organization: { id: string; name?: string; slug?: string | null };
  user?: { id?: string; email?: string; displayName?: string };
  request?: EvaluationRequest;
  conversationEventId?: string | null;
};

/**
 * Organization runtimes can compose a SIEM implementation here without making
 * SIEM an installable Feature. Personal runtimes intentionally keep the no-op
 * provider and expose no SIEM configuration or delivery behavior.
 */
export interface AuditExportProvider {
  readonly id: string;
  exportDecision(input: AuditDecisionExport): Promise<AuditExportResult>;
  exportLog(input: AuditLogExport): Promise<AuditExportResult>;
}

const disabledAuditExportProvider: AuditExportProvider = {
  id: "disabled",
  async exportDecision() {
    return { status: "skipped", summary: "Organization audit export is not configured." };
  },
  async exportLog() {
    return { status: "skipped", summary: "Organization audit export is not configured." };
  },
};

let provider: AuditExportProvider = disabledAuditExportProvider;

export function configureAuditExportProvider(next?: AuditExportProvider) {
  provider = next ?? disabledAuditExportProvider;
}

export function activeAuditExportProviderId() {
  return provider.id;
}

export async function exportAuditDecision(
  input: AuditDecisionExport,
): Promise<AuditExportResult> {
  return safelyExport(() => provider.exportDecision(input));
}

export async function exportAuditLog(
  input: AuditLogExport,
): Promise<AuditExportResult> {
  return safelyExport(() => provider.exportLog(input));
}

async function safelyExport(
  operation: () => Promise<AuditExportResult>,
): Promise<AuditExportResult> {
  try {
    return await operation();
  } catch (error) {
    return {
      status: "failed",
      summary:
        error instanceof Error
          ? error.message
          : "Organization audit export failed.",
    };
  }
}
