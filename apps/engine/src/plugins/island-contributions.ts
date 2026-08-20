import type {
  EvaluationRequest,
  PluginCatalogItem,
  PluginIslandAction,
  PluginIslandContribution,
  PluginIslandPublishRequest,
} from "@openleash/shared";
import { pool } from "../db.js";
import { resolvePluginSettingProfiles } from "./settings-profiles.js";

export type IslandContributionContext = {
  organizationId?: string;
  userId?: string;
  pluginId: string;
  agentId?: string;
  request?: EvaluationRequest;
};

export async function publishIslandContribution(
  context: IslandContributionContext,
  input: PluginIslandPublishRequest,
) {
  const contribution = normalizeIslandContribution(context, input);
  if (!context.organizationId || !context.userId) {
    return { contribution };
  }
  const payload = contributionPayload(contribution);
  const result = await pool.query<{ id: string; updated_at: string; expires_at: string }>(
    `insert into plugin_island_contributions
       (organization_id, user_id, plugin_id, contribution_key, session_id, agent_kind, project_path, kind, payload, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
     on conflict (organization_id, user_id, plugin_id, contribution_key, session_id) do update set
       agent_kind = excluded.agent_kind,
       project_path = excluded.project_path,
       kind = excluded.kind,
       payload = excluded.payload,
       expires_at = excluded.expires_at,
       updated_at = now()
     returning id, updated_at, expires_at`,
    [
      context.organizationId,
      context.userId,
      context.pluginId,
      contribution.key,
      contribution.sessionId ?? "",
      contribution.agentKind ?? null,
      contribution.projectPath ?? null,
      contribution.kind,
      JSON.stringify(payload),
      contribution.expiresAt,
    ],
  );
  const row = result.rows[0];
  return {
    contribution: {
      ...contribution,
      id: row.id,
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    },
  };
}

export async function clearIslandContribution(
  context: IslandContributionContext,
  input: { key: string; sessionId?: string },
) {
  if (!context.organizationId || !context.userId) return;
  const key = cleanRequired(input.key, "key", 80);
  const sessionId = cleanOptional(input.sessionId ?? context.request?.event.sessionId, 200) ?? "";
  await pool.query(
    `delete from plugin_island_contributions
     where organization_id = $1 and user_id = $2 and plugin_id = $3
       and contribution_key = $4 and session_id = $5`,
    [context.organizationId, context.userId, context.pluginId, key, sessionId],
  );
}

export async function activeIslandContributions(
  organizationId: string,
  userId: string,
  plugins: PluginCatalogItem[],
) {
  const [result, latestTokenSavings] = await Promise.all([pool.query<{
    id: string;
    plugin_id: string;
    contribution_key: string;
    session_id: string;
    agent_kind: string | null;
    project_path: string | null;
    kind: PluginIslandContribution["kind"];
    payload: Record<string, unknown>;
    updated_at: string;
    expires_at: string;
  }>(
    `select pic.id, pic.plugin_id, pic.contribution_key, pic.session_id,
            pic.agent_kind, pic.project_path, pic.kind, pic.payload,
            pic.updated_at, pic.expires_at
     from plugin_island_contributions pic
     where pic.organization_id = $1 and pic.user_id = $2
       and pic.expires_at > now()
     order by pic.updated_at desc
     limit 100`,
    [organizationId, userId],
  ), pool.query<{
    input_tokens: number;
    saved_tokens: number;
    occurred_at: string;
  }>(
    `select input_tokens, saved_tokens, occurred_at
     from plugin_usage_records
     where organization_id = $1 and user_id = $2
       and plugin_id = 'openleash.prompt-compression'
       and input_tokens > 0 and saved_tokens >= 0
       and occurred_at >= now() - interval '24 hours'
     order by occurred_at desc, created_at desc
     limit 1`,
    [organizationId, userId],
  )]);
  const contributions = result.rows.map((row): PluginIslandContribution => ({
    schemaVersion: "2026-07-20.plugin-island.v1",
    id: row.id,
    pluginId: row.plugin_id,
    kind: row.kind,
    key: row.contribution_key,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.agent_kind ? { agentKind: row.agent_kind } : {}),
    ...(row.project_path ? { projectPath: row.project_path } : {}),
    ...(row.payload as Omit<PluginIslandContribution, "schemaVersion" | "id" | "pluginId" | "kind" | "key" | "sessionId" | "agentKind" | "projectPath" | "updatedAt" | "expiresAt">),
    updatedAt: new Date(row.updated_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  }));
  if (!contributions.some((item) => item.pluginId === "openleash.prompt-compression" && item.value)) {
    const usage = latestTokenSavings.rows[0];
    if (usage) {
      const inputTokens = Number(usage.input_tokens);
      const savedTokens = Math.max(0, Number(usage.saved_tokens));
      const tokensAfter = Math.max(0, inputTokens - savedTokens);
      const savedPercent = Math.max(0, Math.min(100, Math.round(savedTokens / inputTokens * 100)));
      const now = Date.now();
      contributions.push({
        schemaVersion: "2026-07-20.plugin-island.v1",
        id: "openleash.prompt-compression:token-savings:latest",
        pluginId: "openleash.prompt-compression",
        kind: "annotation",
        key: "token-savings",
        label: "token-saver",
        value: `${savedPercent}% saved`,
        detail: savedPercent > 0
          ? `Reduced the latest model request from ${inputTokens} to ${tokensAfter} estimated tokens.`
          : "Checked the latest model request; no safe compression opportunity was found.",
        tone: savedPercent > 0 ? "success" : "neutral",
        action: { id: "open-token-saver", label: "token-saver settings", type: "open-plugin-settings" },
        updatedAt: new Date(usage.occurred_at).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      });
    }
  }
  return contributions.filter((contribution) => isIslandContributionEnabled(contribution, plugins));
}

export function isIslandContributionEnabled(
  contribution: PluginIslandContribution,
  plugins: PluginCatalogItem[],
) {
  const plugin = plugins.find((candidate) => candidate.id === contribution.pluginId);
  if (!plugin) return false;
  return resolvePluginSettingProfiles({
    enabled: plugin.settings.enabled,
    config: plugin.settings.config,
    organizationProfiles: plugin.settings.inheritedProfiles,
    userProfiles: plugin.settings.profiles,
    agentKind: contribution.agentKind,
    agentId: contribution.agentId,
    projectPath: contribution.projectPath,
    configLocked: plugin.organizationPolicy?.configLocked,
    mandatory: plugin.organizationPolicy?.mandatory,
  }).enabled;
}

export function normalizeIslandContribution(
  context: IslandContributionContext,
  input: PluginIslandPublishRequest,
  now = Date.now(),
): PluginIslandContribution {
  if (!input || typeof input !== "object") throw new Error("island contribution must be an object");
  const kind = input.kind;
  if (kind !== "annotation" && kind !== "activity" && kind !== "status") {
    throw new Error("island contribution kind must be annotation, activity, or status");
  }
  const key = cleanRequired(input.key, "key", 80);
  const ttlSeconds = boundedNumber(input.ttlSeconds, 120, 5, 3_600);
  const sessionId = kind === "status"
    ? undefined
    : cleanOptional(input.sessionId ?? context.request?.event.sessionId, 200);
  if (kind !== "status" && !sessionId) throw new Error("session island contributions require a sessionId");
  const base = {
    schemaVersion: "2026-07-20.plugin-island.v1" as const,
    id: `${context.pluginId}:${key}:${sessionId ?? "global"}`,
    pluginId: context.pluginId,
    kind,
    key,
    ...(sessionId ? { sessionId } : {}),
    ...(context.request?.agent.kind ? { agentKind: context.request.agent.kind } : {}),
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.request?.event.projectPath ? { projectPath: cleanOptional(context.request.event.projectPath, 500) } : {}),
    tone: normalizeTone(input.tone),
    ...(input.action ? { action: normalizeAction(input.action) } : {}),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1_000).toISOString(),
  };
  if (kind === "annotation") return {
    ...base,
    label: cleanRequired(input.label, "label", 80),
    ...(cleanOptional(input.detail, 300) ? { detail: cleanOptional(input.detail, 300) } : {}),
    ...(cleanOptional(input.value, 40) ? { value: cleanOptional(input.value, 40) } : {}),
  };
  if (kind === "activity") return {
    ...base,
    title: cleanRequired(input.title, "title", 100),
    ...(cleanOptional(input.detail, 300) ? { detail: cleanOptional(input.detail, 300) } : {}),
    status: normalizeStatus(input.status),
    ...(input.progress ? { progress: normalizeProgress(input.progress) } : {}),
  };
  return {
    ...base,
    title: cleanRequired(input.title, "title", 100),
    ...(cleanOptional(input.detail, 300) ? { detail: cleanOptional(input.detail, 300) } : {}),
    ...(input.progress ? { progress: normalizeProgress(input.progress) } : {}),
    relatedSessionIds: Array.isArray(input.relatedSessionIds)
      ? [...new Set(input.relatedSessionIds.map((value) => cleanOptional(value, 200)).filter((value): value is string => Boolean(value)))].slice(0, 20)
      : [],
  };
}

function contributionPayload(contribution: PluginIslandContribution) {
  const { schemaVersion: _schema, id: _id, pluginId: _plugin, kind: _kind, key: _key, sessionId: _session, agentKind: _agent, projectPath: _project, updatedAt: _updated, expiresAt: _expires, ...payload } = contribution;
  return payload;
}

function normalizeAction(action: PluginIslandAction): PluginIslandAction {
  const id = cleanRequired(action.id, "action.id", 60);
  const label = cleanRequired(action.label, "action.label", 60);
  if (action.type === "open-session" || action.type === "open-plugin-settings") return { id, label, type: action.type };
  if (action.type === "open-plugin-outcome") return { id, label, type: action.type, outcomeId: cleanRequired(action.outcomeId, "action.outcomeId", 120) };
  throw new Error("unsupported island action type");
}

function normalizeProgress(progress: { current: number; total?: number; label?: string }) {
  const current = boundedNumber(progress.current, 0, 0, 1_000_000_000);
  const total = progress.total == null ? undefined : boundedNumber(progress.total, current, Math.max(1, current), 1_000_000_000);
  return { current, ...(total != null ? { total } : {}), ...(cleanOptional(progress.label, 60) ? { label: cleanOptional(progress.label, 60) } : {}) };
}

function normalizeTone(value: unknown): PluginIslandContribution["tone"] {
  return value === "info" || value === "success" || value === "warning" || value === "danger" ? value : "neutral";
}

function normalizeStatus(value: unknown) {
  if (value === "queued" || value === "running" || value === "waiting" || value === "completed" || value === "failed") return value;
  throw new Error("activity status must be queued, running, waiting, completed, or failed");
}

function cleanRequired(value: unknown, field: string, max: number) {
  const text = cleanOptional(value, max);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function cleanOptional(value: unknown, max: number) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, max) : undefined;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
