create table if not exists plugin_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  plugin_id text not null,
  conversation_event_id uuid references conversation_events(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  computer_id uuid references computers(id) on delete set null,
  agent_runtime_id uuid references agent_runtimes(id) on delete set null,
  kind text not null,
  severity text not null default 'info',
  title text not null,
  summary text,
  decision text,
  status text,
  target jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  correlation_keys text[] not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint plugin_signals_kind_check check (kind in (
    'security.finding',
    'policy.decision',
    'approval.event',
    'secret.detected',
    'tool.risk',
    'mcp.discovery',
    'identity.risk',
    'audit.event',
    'plugin.health',
    'export.status'
  )),
  constraint plugin_signals_severity_check check (severity in ('info', 'low', 'medium', 'high', 'critical'))
);

create index if not exists plugin_signals_org_created_idx on plugin_signals(organization_id, created_at desc);
create index if not exists plugin_signals_kind_created_idx on plugin_signals(organization_id, kind, created_at desc);
create index if not exists plugin_signals_severity_created_idx on plugin_signals(organization_id, severity, created_at desc);
create index if not exists plugin_signals_user_created_idx on plugin_signals(user_id, created_at desc);
create index if not exists plugin_signals_plugin_created_idx on plugin_signals(plugin_id, created_at desc);
create index if not exists plugin_signals_correlation_idx on plugin_signals using gin (correlation_keys);

create table if not exists plugin_usage_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  plugin_id text not null,
  conversation_event_id uuid references conversation_events(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  computer_id uuid references computers(id) on delete set null,
  agent_runtime_id uuid references agent_runtimes(id) on delete set null,
  kind text not null,
  provider text,
  model text,
  quantity numeric,
  unit text,
  input_tokens integer,
  output_tokens integer,
  saved_tokens integer,
  estimated_cost_cents integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint plugin_usage_records_kind_check check (kind in (
    'llm.tokens',
    'plugin.compute',
    'plugin.operation',
    'network.egress',
    'storage.bytes'
  ))
);

create index if not exists plugin_usage_org_created_idx on plugin_usage_records(organization_id, created_at desc);
create index if not exists plugin_usage_user_created_idx on plugin_usage_records(user_id, created_at desc);
create index if not exists plugin_usage_plugin_created_idx on plugin_usage_records(plugin_id, created_at desc);
create index if not exists plugin_usage_kind_created_idx on plugin_usage_records(organization_id, kind, created_at desc);
