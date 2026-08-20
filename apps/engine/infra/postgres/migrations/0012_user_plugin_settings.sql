create table if not exists user_plugin_settings (
  user_id uuid references users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  plugin_id text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  ordering_priority integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, plugin_id)
);

create index if not exists user_plugin_settings_org_idx on user_plugin_settings(organization_id, plugin_id);
