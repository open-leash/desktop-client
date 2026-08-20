create table if not exists provider_usage_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  provider text not null,
  label text,
  enabled boolean not null default true,
  status text not null default 'pending',
  credential_ciphertext text not null,
  credential_key_id text,
  metadata jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, provider)
);

create index if not exists provider_usage_connections_org_idx
  on provider_usage_connections(organization_id, enabled);

create table if not exists provider_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  connection_id uuid references provider_usage_connections(id) on delete cascade,
  provider text not null,
  external_id text not null,
  provider_user_email text,
  provider_user_name text,
  model text,
  usage_kind text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  request_count integer not null default 0,
  cost_cents double precision not null default 0,
  currency text not null default 'usd',
  occurred_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(provider, external_id)
);

create index if not exists provider_usage_events_org_time_idx
  on provider_usage_events(organization_id, occurred_at desc);

create index if not exists provider_usage_events_connection_idx
  on provider_usage_events(connection_id);

create index if not exists provider_usage_events_user_idx
  on provider_usage_events(organization_id, provider_user_email);

create table if not exists provider_usage_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  provider text,
  scope text not null default 'organization',
  scope_key text not null default 'organization',
  monthly_budget_cents integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, provider, scope, scope_key)
);

create index if not exists provider_usage_budgets_org_idx
  on provider_usage_budgets(organization_id, enabled);

create table if not exists provider_usage_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  provider text,
  status text not null default 'queued',
  triggered_by text,
  records integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists provider_usage_sync_jobs_org_idx
  on provider_usage_sync_jobs(organization_id, created_at desc);
