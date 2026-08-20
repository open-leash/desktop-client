create table if not exists plugin_settings (
  organization_id uuid references organizations(id) on delete cascade,
  plugin_id text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  ordering_priority integer,
  updated_at timestamptz not null default now(),
  primary key (organization_id, plugin_id)
);

create index if not exists plugin_settings_org_idx on plugin_settings(organization_id, plugin_id);
