create table if not exists session_monitoring_pauses (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  agent_kind text not null,
  session_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, agent_kind, session_id)
);

create index if not exists session_monitoring_pauses_expiry_idx
  on session_monitoring_pauses (expires_at);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'openleash') then
    grant select, insert, update, delete on table session_monitoring_pauses to openleash;
  end if;
end
$$;

comment on table session_monitoring_pauses is
  'Short-lived, user-scoped conversation monitoring bypasses. Organization-managed accounts cannot create them.';
