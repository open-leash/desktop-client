create table if not exists plugin_island_contributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  plugin_id text not null,
  contribution_key text not null,
  session_id text not null default '',
  agent_kind text,
  project_path text,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plugin_island_kind_check check (kind in ('annotation', 'activity', 'status')),
  unique (organization_id, user_id, plugin_id, contribution_key, session_id)
);

create index if not exists plugin_island_user_active_idx
  on plugin_island_contributions (organization_id, user_id, expires_at desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'openleash') then
    grant select, insert, update, delete on table plugin_island_contributions to openleash;
  end if;
end
$$;

comment on table plugin_island_contributions is
  'Short-lived, typed island presentation data published by authorized plugins and rendered by trusted OpenLeash clients.';
