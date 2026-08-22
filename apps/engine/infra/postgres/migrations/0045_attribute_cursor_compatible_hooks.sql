-- Reattribute Cursor sessions emitted through Claude-compatible hook settings.
-- Cursor includes definitive client markers in these payloads even when it executes
-- ~/.claude/settings.json. Preserve the event history while linking it to Cursor.

insert into agent_runtimes
  (computer_id, kind, display_name, executable_path, installed, protected, detail, last_seen_at)
select
  ce.computer_id,
  'cursor',
  'Cursor',
  null,
  true,
  false,
  'Observed from Cursor hook payload',
  max(ce.created_at)
from conversation_events ce
join agent_runtimes configured_runtime on configured_runtime.id = ce.agent_runtime_id
where configured_runtime.kind = 'claude-code'
  and (
    coalesce(ce.payload->'raw'->>'cursor_version', ce.payload->'raw'->>'cursorVersion', '') <> ''
    or lower(coalesce(
      ce.payload->'raw'->>'client',
      ce.payload->'raw'->>'client_name',
      ce.payload->'raw'->>'clientName',
      ce.payload->'raw'->>'application',
      ce.payload->'raw'->>'application_name',
      ce.payload->'raw'->>'applicationName',
      ce.payload->'raw'->>'ide',
      ''
    )) = 'cursor'
  )
group by ce.computer_id
on conflict (computer_id, kind, executable_path_key) do update set
  display_name = excluded.display_name,
  last_seen_at = greatest(agent_runtimes.last_seen_at, excluded.last_seen_at);

with reassignment as (
  select ce.id as conversation_event_id, cursor_runtime.id as cursor_runtime_id
  from conversation_events ce
  join agent_runtimes configured_runtime on configured_runtime.id = ce.agent_runtime_id
  join agent_runtimes cursor_runtime
    on cursor_runtime.computer_id = ce.computer_id
   and cursor_runtime.kind = 'cursor'
   and cursor_runtime.executable_path_key = ''
  where configured_runtime.kind = 'claude-code'
    and (
      coalesce(ce.payload->'raw'->>'cursor_version', ce.payload->'raw'->>'cursorVersion', '') <> ''
      or lower(coalesce(
        ce.payload->'raw'->>'client',
        ce.payload->'raw'->>'client_name',
        ce.payload->'raw'->>'clientName',
        ce.payload->'raw'->>'application',
        ce.payload->'raw'->>'application_name',
        ce.payload->'raw'->>'applicationName',
        ce.payload->'raw'->>'ide',
        ''
      )) = 'cursor'
    )
)
update plugin_log_events target
set agent_runtime_id = reassignment.cursor_runtime_id
from reassignment
where target.conversation_event_id = reassignment.conversation_event_id;

with reassignment as (
  select ce.id as conversation_event_id, cursor_runtime.id as cursor_runtime_id
  from conversation_events ce
  join agent_runtimes configured_runtime on configured_runtime.id = ce.agent_runtime_id
  join agent_runtimes cursor_runtime
    on cursor_runtime.computer_id = ce.computer_id
   and cursor_runtime.kind = 'cursor'
   and cursor_runtime.executable_path_key = ''
  where configured_runtime.kind = 'claude-code'
    and (
      coalesce(ce.payload->'raw'->>'cursor_version', ce.payload->'raw'->>'cursorVersion', '') <> ''
      or lower(coalesce(ce.payload->'raw'->>'client', ce.payload->'raw'->>'client_name', ce.payload->'raw'->>'clientName', ce.payload->'raw'->>'application', ce.payload->'raw'->>'application_name', ce.payload->'raw'->>'applicationName', ce.payload->'raw'->>'ide', '')) = 'cursor'
    )
)
update plugin_signals target
set agent_runtime_id = reassignment.cursor_runtime_id
from reassignment
where target.conversation_event_id = reassignment.conversation_event_id;

with reassignment as (
  select ce.id as conversation_event_id, cursor_runtime.id as cursor_runtime_id
  from conversation_events ce
  join agent_runtimes configured_runtime on configured_runtime.id = ce.agent_runtime_id
  join agent_runtimes cursor_runtime
    on cursor_runtime.computer_id = ce.computer_id
   and cursor_runtime.kind = 'cursor'
   and cursor_runtime.executable_path_key = ''
  where configured_runtime.kind = 'claude-code'
    and (
      coalesce(ce.payload->'raw'->>'cursor_version', ce.payload->'raw'->>'cursorVersion', '') <> ''
      or lower(coalesce(ce.payload->'raw'->>'client', ce.payload->'raw'->>'client_name', ce.payload->'raw'->>'clientName', ce.payload->'raw'->>'application', ce.payload->'raw'->>'application_name', ce.payload->'raw'->>'applicationName', ce.payload->'raw'->>'ide', '')) = 'cursor'
    )
)
update plugin_usage_records target
set agent_runtime_id = reassignment.cursor_runtime_id
from reassignment
where target.conversation_event_id = reassignment.conversation_event_id;

with reassignment as (
  select ce.id as conversation_event_id, cursor_runtime.id as cursor_runtime_id
  from conversation_events ce
  join agent_runtimes configured_runtime on configured_runtime.id = ce.agent_runtime_id
  join agent_runtimes cursor_runtime
    on cursor_runtime.computer_id = ce.computer_id
   and cursor_runtime.kind = 'cursor'
   and cursor_runtime.executable_path_key = ''
  where configured_runtime.kind = 'claude-code'
    and (
      coalesce(ce.payload->'raw'->>'cursor_version', ce.payload->'raw'->>'cursorVersion', '') <> ''
      or lower(coalesce(ce.payload->'raw'->>'client', ce.payload->'raw'->>'client_name', ce.payload->'raw'->>'clientName', ce.payload->'raw'->>'application', ce.payload->'raw'->>'application_name', ce.payload->'raw'->>'applicationName', ce.payload->'raw'->>'ide', '')) = 'cursor'
    )
)
update mcp_tool_calls target
set agent_runtime_id = reassignment.cursor_runtime_id
from reassignment
where target.conversation_event_id = reassignment.conversation_event_id;

with reassignment as (
  select ce.id as conversation_event_id, cursor_runtime.id as cursor_runtime_id
  from conversation_events ce
  join agent_runtimes configured_runtime on configured_runtime.id = ce.agent_runtime_id
  join agent_runtimes cursor_runtime
    on cursor_runtime.computer_id = ce.computer_id
   and cursor_runtime.kind = 'cursor'
   and cursor_runtime.executable_path_key = ''
  where configured_runtime.kind = 'claude-code'
    and (
      coalesce(ce.payload->'raw'->>'cursor_version', ce.payload->'raw'->>'cursorVersion', '') <> ''
      or lower(coalesce(
        ce.payload->'raw'->>'client',
        ce.payload->'raw'->>'client_name',
        ce.payload->'raw'->>'clientName',
        ce.payload->'raw'->>'application',
        ce.payload->'raw'->>'application_name',
        ce.payload->'raw'->>'applicationName',
        ce.payload->'raw'->>'ide',
        ''
      )) = 'cursor'
    )
)
update conversation_events target
set agent_runtime_id = reassignment.cursor_runtime_id,
    provider = 'cursor',
    payload = jsonb_set(target.payload, '{agentKind}', '"cursor"'::jsonb, true)
from reassignment
where target.id = reassignment.conversation_event_id;
