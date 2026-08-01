create table if not exists plugin_log_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  plugin_id text not null,
  conversation_event_id uuid references conversation_events(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  computer_id uuid references computers(id) on delete set null,
  agent_runtime_id uuid references agent_runtimes(id) on delete set null,
  level text not null,
  category text not null default 'plugin',
  code text,
  message text not null,
  scope jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint plugin_log_events_level_check check (level in ('debug', 'info', 'warn', 'error', 'security')),
  constraint plugin_log_events_category_check check (category in ('system', 'plugin', 'security', 'audit'))
);

create index if not exists plugin_log_events_org_created_idx on plugin_log_events(organization_id, created_at desc);
create index if not exists plugin_log_events_plugin_created_idx on plugin_log_events(plugin_id, created_at desc);
create index if not exists plugin_log_events_conversation_idx on plugin_log_events(conversation_event_id, created_at asc);
