alter table conversation_events add column if not exists source text not null default 'api_hook';
alter table conversation_events add column if not exists provider text;
alter table conversation_events add column if not exists idempotency_key text;
alter table conversation_events add column if not exists correlation_id text;
alter table conversation_events add column if not exists source_capabilities jsonb not null default '{"observe":true,"block":true,"rewritePrompt":false,"rewriteToolInput":true,"rewriteResponse":false}'::jsonb;

create unique index if not exists conversation_events_user_idempotency_key_uidx
  on conversation_events (user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists conversation_events_source_created_idx
  on conversation_events (source, created_at desc);
