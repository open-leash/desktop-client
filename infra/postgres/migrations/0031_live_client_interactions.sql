create or replace function openleash_notify_client_sync()
returns trigger
language plpgsql
as $$
declare
  owner_user_id uuid;
  owner_organization_id uuid;
  event_kind text;
  event_id uuid;
begin
  if tg_table_name = 'conversation_events' then
    owner_user_id := new.user_id;
    event_kind := 'activity.created';
    event_id := new.id;
  else
    owner_user_id := new.user_id;
    event_id := new.id;
    if tg_op = 'UPDATE' and old.resolution is null and new.resolution is not null then
      event_kind := 'interaction.resolved';
    elsif tg_op = 'INSERT' and new.decision in ('ask', 'deny') then
      event_kind := 'interaction.created';
    else
      return new;
    end if;
  end if;

  if owner_user_id is null then
    return new;
  end if;

  select organization_id
    into owner_organization_id
    from users
   where id = owner_user_id;

  perform pg_notify(
    'openleash_client_sync',
    json_build_object(
      'schemaVersion', '2026-07-27.client-sync.v1',
      'id', event_id,
      'kind', event_kind,
      'occurredAt', now(),
      'userId', owner_user_id,
      'organizationId', owner_organization_id
    )::text
  );
  return new;
end;
$$;

drop trigger if exists conversation_events_client_sync on conversation_events;
create trigger conversation_events_client_sync
after insert on conversation_events
for each row execute function openleash_notify_client_sync();

drop trigger if exists evaluations_client_sync on evaluations;
create trigger evaluations_client_sync
after insert or update of resolution on evaluations
for each row execute function openleash_notify_client_sync();
