create table if not exists agent_monitoring_settings (
  user_id uuid references users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  kind text not null,
  monitored boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create index if not exists agent_monitoring_settings_org_idx on agent_monitoring_settings(organization_id, kind);
