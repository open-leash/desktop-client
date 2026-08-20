create table if not exists plugin_state (
  organization_id uuid references organizations(id) on delete cascade,
  plugin_id text not null,
  scope_key text not null default 'global',
  state_key text not null,
  value jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, plugin_id, scope_key, state_key)
);

create index if not exists plugin_state_expiry_idx on plugin_state(expires_at) where expires_at is not null;

