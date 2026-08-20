import type {
  EvaluationRequest,
  McpToolCall,
  OpenLeashPluginManifest,
  PipelineEvent,
  PluginCapabilities,
  PluginDlpAction,
  PluginDlpCategory,
  PluginFinding,
  PluginPromptPipelineConfig,
  PluginSettingState,
  PluginRunRecord,
  Policy,
  PolicyDecision
} from "@openleash/shared";
import type { TenantModelKey } from "../model-keys.js";

export type PluginExecutionContext = {
  event: PipelineEvent;
  request: EvaluationRequest;
  capabilities: PluginCapabilities;
  startedAt: number;
};

export type PromptPipelineInput = {
  request: EvaluationRequest;
  config: PluginPromptPipelineConfig;
  organizationId?: string;
  conversationEventId?: string;
  userId?: string;
  computerId?: string;
  runtimeId?: string;
  tenantModelKey?: TenantModelKey;
  plugins?: Map<string, PluginSettingState>;
};

export type PromptPipelineResult = {
  finalPrompt: string;
  blocked: boolean;
  /** A required plugin could not run, so the action must be reviewed by a person. */
  requiresApproval?: boolean;
  summary: string;
  model: string;
  compression?: {
    enabled: boolean;
    originalLength: number;
    compressedLength: number;
    ratio: number;
  };
  dlp?: {
    enabled: boolean;
    action: PluginDlpAction;
    matched: boolean;
    categories: PluginDlpCategory[];
    findings: Array<{ category: PluginDlpCategory; quote: string; reason: string }>;
    masked: boolean;
  };
  runs: PluginRunRecord[];
};

export type EvaluationPipelineInput = {
  request: EvaluationRequest;
  organizationId?: string;
  conversationEventId?: string;
  userId?: string;
  computerId?: string;
  runtimeId?: string;
  policies: Policy[];
  tenantModelKey?: TenantModelKey;
  plugins?: Map<string, PluginSettingState>;
};

export type EvaluationPipelineResult = {
  results: PolicyDecision[];
  model: string;
  runs: PluginRunRecord[];
  mcpCall?: McpToolCall;
};

export type SkillObservationInput = {
  event?: Extract<PipelineEvent, "skill.detected" | "skill.changed" | "skill.removed">;
  agentKind: string;
  agentName: string;
  skillName: string;
  skillPath: string;
  content?: string | null;
  contentPreview?: string | null;
  status?: string;
  riskScore?: number;
  reasons?: Array<{ reason: string; quote?: string }>;
};

export type SkillObservationResult = {
  status: "observed" | "suspicious";
  riskScore: number;
  reasons: Array<{ reason: string; quote?: string }>;
  findings: PluginFinding[];
  run: PluginRunRecord;
};

export type OpenLeashCorePlugin = {
  manifest: OpenLeashPluginManifest;
};

export function pluginRun({
  pluginId,
  event,
  status,
  summary,
  startedAt,
  findings,
  metadata
}: {
  pluginId: string;
  event: PipelineEvent;
  status: PluginRunRecord["status"];
  summary: string;
  startedAt: number;
  findings?: PluginFinding[];
  metadata?: Record<string, unknown>;
}): PluginRunRecord {
  return {
    pluginId,
    event,
    status,
    summary,
    durationMs: Math.max(0, Date.now() - startedAt),
    findings,
    metadata
  };
}
