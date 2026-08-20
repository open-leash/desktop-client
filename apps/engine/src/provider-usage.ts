import crypto from "node:crypto";
import { type PoolClient } from "pg";
import { pool } from "./db.js";

export const USAGE_PROVIDERS = ["cursor", "openai", "anthropic"] as const;
export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

type ProviderCredential = {
  apiKey: string;
  externalOrgId?: string;
};

type ProviderUsageEvent = {
  externalId: string;
  providerUserEmail?: string | null;
  providerUserName?: string | null;
  model?: string | null;
  usageKind?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  requestCount?: number;
  costCents?: number;
  currency?: string;
  occurredAt: string;
  raw: unknown;
};

const PROVIDER_LABELS: Record<UsageProvider, string> = {
  cursor: "Cursor",
  openai: "OpenAI",
  anthropic: "Claude"
};

export function normalizeUsageProvider(value: unknown): UsageProvider | undefined {
  const normalized = String(value ?? "").toLowerCase().trim();
  if (normalized === "claude") return "anthropic";
  return USAGE_PROVIDERS.find((provider) => provider === normalized);
}

export function providerLabel(provider: UsageProvider) {
  return PROVIDER_LABELS[provider];
}

export async function listProviderUsageConnections(organizationId: string) {
  const result = await pool.query(
    `select c.id, c.provider, c.label, c.enabled, c.status, c.last_sync_at, c.last_error,
            c.last_validated_at, c.created_at, c.updated_at,
            coalesce(stats.total_cost_cents, 0)::float8 as total_cost_cents,
            coalesce(stats.event_count, 0)::int as event_count
     from provider_usage_connections c
     left join lateral (
       select sum(cost_cents) as total_cost_cents, count(*) as event_count
       from provider_usage_events e
       where e.connection_id = c.id
     ) stats on true
     where c.organization_id = $1
     order by c.provider asc, c.created_at asc`,
    [organizationId]
  );
  return result.rows;
}

export async function upsertProviderUsageConnection({
  organizationId,
  provider,
  label,
  apiKey,
  externalOrgId
}: {
  organizationId: string;
  provider: UsageProvider;
  label?: string;
  apiKey: string;
  externalOrgId?: string;
}) {
  const validation = await validateProviderCredential(provider, { apiKey, externalOrgId });
  if (!validation.ok) {
    return validation;
  }

  const credential = encryptCredential({ apiKey, externalOrgId });
  const result = await pool.query(
    `insert into provider_usage_connections
       (organization_id, provider, label, credential_ciphertext, credential_key_id, status, last_validated_at, last_error, metadata, updated_at)
     values ($1, $2, $3, $4, $5, 'connected', now(), null, $6, now())
     on conflict (organization_id, provider) do update
       set label = excluded.label,
           credential_ciphertext = excluded.credential_ciphertext,
           credential_key_id = excluded.credential_key_id,
           enabled = true,
           status = 'connected',
           last_validated_at = now(),
           last_error = null,
           metadata = excluded.metadata,
           updated_at = now()
     returning id, provider, label, enabled, status, last_validated_at, created_at, updated_at`,
    [
      organizationId,
      provider,
      label?.trim() || providerLabel(provider),
      credential.ciphertext,
      credential.keyId,
      JSON.stringify(validation.metadata ?? {})
    ]
  );
  return { ok: true as const, connection: result.rows[0] };
}

export async function validateProviderConnection(organizationId: string, provider: UsageProvider) {
  const connection = await connectionWithCredential(organizationId, provider);
  if (!connection) return { ok: false as const, message: "Provider connection not found" };
  const validation = await validateProviderCredential(provider, connection.credential);
  await pool.query(
    `update provider_usage_connections
     set status = $3, last_validated_at = now(), last_error = $4, metadata = metadata || $5::jsonb, updated_at = now()
     where organization_id = $1 and provider = $2`,
    [
      organizationId,
      provider,
      validation.ok ? "connected" : "error",
      validation.ok ? null : validation.message,
      JSON.stringify(validation.metadata ?? {})
    ]
  );
  return validation;
}

export async function upsertProviderUsageBudget({
  organizationId,
  provider,
  monthlyBudgetCents
}: {
  organizationId: string;
  provider?: UsageProvider;
  monthlyBudgetCents: number;
}) {
  const normalizedBudget = Math.max(0, Math.round(monthlyBudgetCents));
  const updated = await pool.query(
    `update provider_usage_budgets
     set monthly_budget_cents = $3, enabled = true, updated_at = now()
     where organization_id = $1
       and coalesce(provider, 'all') = coalesce($2, 'all')
       and scope = 'organization'
       and scope_key = 'organization'
     returning id, provider, monthly_budget_cents, enabled, updated_at`,
    [organizationId, provider ?? null, normalizedBudget]
  );
  if (updated.rows[0]) return updated.rows[0];
  const inserted = await pool.query(
    `insert into provider_usage_budgets (organization_id, provider, scope, scope_key, monthly_budget_cents)
     values ($1, $2, 'organization', 'organization', $3)
     returning id, provider, monthly_budget_cents, enabled, updated_at`,
    [organizationId, provider ?? null, normalizedBudget]
  );
  return inserted.rows[0];
}

export async function syncProviderUsage(organizationId: string, provider?: UsageProvider) {
  const connections = await providerUsageConnectionsWithCredentials(organizationId, provider);
  const synced: Array<{ provider: UsageProvider; events: number }> = [];
  const failed: Array<{ provider: UsageProvider; error: string }> = [];

  for (const connection of connections) {
    try {
      const end = new Date();
      const start = connection.last_sync_at ? new Date(connection.last_sync_at) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const events = await fetchProviderUsage(connection.provider, connection.credential, start, end);
      await upsertUsageEvents(connection.id, organizationId, connection.provider, events);
      await pool.query(
        `update provider_usage_connections
         set status = 'connected', last_sync_at = now(), last_error = null, updated_at = now()
         where id = $1`,
        [connection.id]
      );
      synced.push({ provider: connection.provider, events: events.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      await pool.query(
        `update provider_usage_connections
         set status = 'error', last_error = $2, updated_at = now()
         where id = $1`,
        [connection.id, message]
      );
      failed.push({ provider: connection.provider, error: message });
    }
  }

  return { ok: failed.length === 0, synced, failed };
}

export async function providerUsageOverview(organizationId: string, start: Date) {
  const [summary, byProvider, byUser, byModel, connections, budgets] = await Promise.all([
    pool.query(
      `select
         coalesce(sum(cost_cents), 0)::float8 as total_cost_cents,
         coalesce(sum(request_count), 0)::int as request_count,
         coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::bigint as token_count,
         count(distinct provider_user_email) filter (where provider_user_email is not null)::int as user_count,
         count(distinct provider)::int as provider_count
       from provider_usage_events
       where organization_id = $1 and occurred_at >= $2`,
      [organizationId, start.toISOString()]
    ),
    pool.query(
      `select provider,
              coalesce(sum(cost_cents), 0)::float8 as cost_cents,
              coalesce(sum(request_count), 0)::int as request_count,
              coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::bigint as token_count,
              count(distinct provider_user_email) filter (where provider_user_email is not null)::int as user_count
       from provider_usage_events
       where organization_id = $1 and occurred_at >= $2
       group by provider
       order by cost_cents desc`,
      [organizationId, start.toISOString()]
    ),
    pool.query(
      `select coalesce(provider_user_email, 'unknown') as email,
              max(provider_user_name) as name,
              coalesce(sum(cost_cents), 0)::float8 as cost_cents,
              coalesce(sum(request_count), 0)::int as request_count,
              coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::bigint as token_count,
              max(occurred_at) as last_seen_at
       from provider_usage_events
       where organization_id = $1 and occurred_at >= $2
       group by coalesce(provider_user_email, 'unknown')
       order by cost_cents desc
       limit 50`,
      [organizationId, start.toISOString()]
    ),
    pool.query(
      `select provider, coalesce(model, 'unknown') as model,
              coalesce(sum(cost_cents), 0)::float8 as cost_cents,
              coalesce(sum(request_count), 0)::int as request_count,
              coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::bigint as token_count
       from provider_usage_events
       where organization_id = $1 and occurred_at >= $2
       group by provider, coalesce(model, 'unknown')
       order by cost_cents desc
       limit 50`,
      [organizationId, start.toISOString()]
    ),
    listProviderUsageConnections(organizationId),
    pool.query(
      `select provider, monthly_budget_cents::float8 as monthly_budget_cents, enabled, updated_at
       from provider_usage_budgets
       where organization_id = $1 and enabled = true and scope = 'organization'
       order by provider nulls first`,
      [organizationId]
    )
  ]);

  return {
    summary: summary.rows[0],
    byProvider: byProvider.rows,
    byUser: byUser.rows,
    byModel: byModel.rows,
    connections,
    budgets: budgets.rows
  };
}

async function validateProviderCredential(provider: UsageProvider, credential: ProviderCredential) {
  try {
    if (provider === "cursor") {
      const response = await fetch("https://api.cursor.com/teams/members", {
        headers: cursorAuthHeaders(credential.apiKey)
      });
      if (!response.ok) return { ok: false as const, message: `Cursor rejected the key (${response.status})` };
      const data = await response.json().catch(() => ({}));
      return { ok: true as const, metadata: { memberCount: Array.isArray(data.teamMembers) ? data.teamMembers.length : undefined } };
    }
    if (provider === "openai") {
      const params = new URLSearchParams({ start_time: String(Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000)), limit: "1" });
      const response = await fetch(`https://api.openai.com/v1/organization/costs?${params}`, {
        headers: { authorization: `Bearer ${credential.apiKey}` }
      });
      if (!response.ok) return { ok: false as const, message: `OpenAI rejected the admin key (${response.status})` };
      return { ok: true as const, metadata: {} };
    }
    const params = new URLSearchParams({
      starting_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      limit: "1",
      bucket_width: "1d"
    });
    const response = await fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?${params}`, {
      headers: {
        "x-api-key": credential.apiKey,
        "anthropic-version": "2023-06-01"
      }
    });
    if (!response.ok) return { ok: false as const, message: `Claude rejected the admin key (${response.status})` };
    return { ok: true as const, metadata: {} };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Validation failed" };
  }
}

async function fetchProviderUsage(provider: UsageProvider, credential: ProviderCredential, start: Date, end: Date): Promise<ProviderUsageEvent[]> {
  if (provider === "cursor") return fetchCursorUsage(credential.apiKey, start, end);
  if (provider === "openai") return fetchOpenAiUsage(credential.apiKey, start, end);
  return fetchAnthropicUsage(credential.apiKey, start, end);
}

async function fetchCursorUsage(apiKey: string, start: Date, end: Date) {
  const events: ProviderUsageEvent[] = [];
  let page = 1;
  for (;;) {
    const response = await fetch("https://api.cursor.com/teams/filtered-usage-events", {
      method: "POST",
      headers: { ...cursorAuthHeaders(apiKey), "content-type": "application/json" },
      body: JSON.stringify({ startDate: start.getTime(), endDate: end.getTime(), page, pageSize: 100 })
    });
    if (!response.ok) throw new Error(`Cursor usage sync failed (${response.status})`);
    const data = await response.json() as any;
    for (const event of data.usageEvents ?? []) {
      events.push({
        externalId: `cursor:${event.timestamp}:${event.userEmail ?? "unknown"}:${event.model ?? "unknown"}:${event.chargedCents ?? event.requestsCosts ?? ""}`,
        providerUserEmail: event.userEmail ?? null,
        model: event.model ?? null,
        usageKind: event.kind ?? null,
        inputTokens: Number(event.tokenUsage?.inputTokens ?? 0),
        outputTokens: Number(event.tokenUsage?.outputTokens ?? 0),
        cacheReadTokens: Number(event.tokenUsage?.cacheReadTokens ?? 0),
        cacheWriteTokens: Number(event.tokenUsage?.cacheWriteTokens ?? 0),
        requestCount: 1,
        costCents: Number(event.chargedCents ?? event.tokenUsage?.totalCents ?? event.requestsCosts ?? 0),
        occurredAt: new Date(Number(event.timestamp) || Date.parse(event.timestamp)).toISOString(),
        raw: event
      });
    }
    if (!data.pagination?.hasNextPage) break;
    page += 1;
  }
  return events;
}

async function fetchOpenAiUsage(apiKey: string, start: Date, end: Date) {
  const events: ProviderUsageEvent[] = [];
  const params = new URLSearchParams({
    start_time: String(Math.floor(start.getTime() / 1000)),
    end_time: String(Math.floor(end.getTime() / 1000)),
    limit: "180"
  });
  params.append("group_by[]", "project_id");
  params.append("group_by[]", "line_item");
  const response = await fetch(`https://api.openai.com/v1/organization/costs?${params}`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) throw new Error(`OpenAI costs sync failed (${response.status})`);
  const data = await response.json() as any;
  for (const bucket of data.data ?? []) {
    for (const result of bucket.results ?? []) {
      events.push({
        externalId: `openai:${bucket.start_time}:${result.project_id ?? "org"}:${result.line_item ?? "all"}`,
        model: result.line_item ?? null,
        usageKind: "cost",
        requestCount: 0,
        costCents: Number(result.amount?.value ?? 0) * 100,
        currency: result.amount?.currency ?? "usd",
        occurredAt: new Date(Number(bucket.start_time) * 1000).toISOString(),
        raw: { bucket, result }
      });
    }
  }
  return events;
}

async function fetchAnthropicUsage(apiKey: string, start: Date, end: Date) {
  const params = new URLSearchParams({
    starting_at: start.toISOString(),
    ending_at: end.toISOString(),
    bucket_width: "1d",
    limit: "31"
  });
  params.append("group_by[]", "workspace_id");
  params.append("group_by[]", "model");
  const response = await fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?${params}`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });
  if (!response.ok) throw new Error(`Claude usage sync failed (${response.status})`);
  const data = await response.json() as any;
  const events: ProviderUsageEvent[] = [];
  for (const bucket of data.data ?? []) {
    for (const result of bucket.results ?? []) {
      events.push({
        externalId: `anthropic:${bucket.starting_at}:${result.workspace_id ?? "org"}:${result.model ?? "all"}`,
        model: result.model ?? null,
        usageKind: "messages",
        inputTokens: Number(result.uncached_input_tokens ?? 0),
        outputTokens: Number(result.output_tokens ?? 0),
        cacheReadTokens: Number(result.cache_read_input_tokens ?? 0),
        cacheWriteTokens: Number(result.cache_creation?.ephemeral_1h_input_tokens ?? 0) + Number(result.cache_creation?.ephemeral_5m_input_tokens ?? 0),
        requestCount: Number(result.server_tool_use?.web_search_requests ?? 0),
        occurredAt: bucket.starting_at,
        raw: { bucket, result }
      });
    }
  }
  return events;
}

async function upsertUsageEvents(connectionId: string, organizationId: string, provider: UsageProvider, events: ProviderUsageEvent[]) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const event of events) {
      await upsertUsageEvent(client, connectionId, organizationId, provider, event);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertUsageEvent(client: PoolClient, connectionId: string, organizationId: string, provider: UsageProvider, event: ProviderUsageEvent) {
  await client.query(
    `insert into provider_usage_events
       (organization_id, connection_id, provider, external_id, provider_user_email, provider_user_name, model, usage_kind,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, request_count, cost_cents, currency, occurred_at, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict (provider, external_id) do update set
       provider_user_email = excluded.provider_user_email,
       provider_user_name = excluded.provider_user_name,
       model = excluded.model,
       usage_kind = excluded.usage_kind,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       cache_write_tokens = excluded.cache_write_tokens,
       request_count = excluded.request_count,
       cost_cents = excluded.cost_cents,
       currency = excluded.currency,
       raw = excluded.raw`,
    [
      organizationId,
      connectionId,
      provider,
      event.externalId,
      event.providerUserEmail ?? null,
      event.providerUserName ?? null,
      event.model ?? null,
      event.usageKind ?? null,
      Math.round(event.inputTokens ?? 0),
      Math.round(event.outputTokens ?? 0),
      Math.round(event.cacheReadTokens ?? 0),
      Math.round(event.cacheWriteTokens ?? 0),
      Math.round(event.requestCount ?? 0),
      event.costCents ?? 0,
      event.currency ?? "usd",
      event.occurredAt,
      JSON.stringify(event.raw ?? {})
    ]
  );
}

async function providerUsageConnectionsWithCredentials(organizationId: string, provider?: UsageProvider) {
  const params: unknown[] = [organizationId];
  const providerFilter = provider ? "and provider = $2" : "";
  if (provider) params.push(provider);
  const result = await pool.query(
    `select id, provider, credential_ciphertext, credential_key_id, last_sync_at
     from provider_usage_connections
     where organization_id = $1 and enabled = true ${providerFilter}
     order by provider asc`,
    params
  );
  return result.rows.map(row => ({
    id: row.id as string,
    provider: row.provider as UsageProvider,
    last_sync_at: row.last_sync_at as string | null,
    credential: decryptCredential(row.credential_ciphertext)
  }));
}

async function connectionWithCredential(organizationId: string, provider: UsageProvider) {
  const connections = await providerUsageConnectionsWithCredentials(organizationId, provider);
  return connections[0];
}

function cursorAuthHeaders(apiKey: string) {
  return { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` };
}

function encryptCredential(credential: ProviderCredential) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyId: process.env.OPENLEASH_PROVIDER_USAGE_KEY_ID ?? "default",
    ciphertext: Buffer.concat([iv, tag, encrypted]).toString("base64")
  };
}

function decryptCredential(ciphertext: string): ProviderCredential {
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as ProviderCredential;
}

function encryptionKey() {
  const secret = process.env.OPENLEASH_PROVIDER_USAGE_ENCRYPTION_KEY ?? process.env.OPENLEASH_SECRET_KEY ?? "openleash-local-dev-provider-usage-key";
  return crypto.createHash("sha256").update(secret).digest();
}
