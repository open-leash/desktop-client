alter table plugin_settings
  add column if not exists profiles jsonb not null default '[]'::jsonb;

alter table user_plugin_settings
  add column if not exists profiles jsonb not null default '[]'::jsonb;

alter table plugin_settings
  drop constraint if exists plugin_settings_profiles_array_check,
  add constraint plugin_settings_profiles_array_check
    check (jsonb_typeof(profiles) = 'array');

alter table user_plugin_settings
  drop constraint if exists user_plugin_settings_profiles_array_check,
  add constraint user_plugin_settings_profiles_array_check
    check (jsonb_typeof(profiles) = 'array');

-- Releases created before container execution became first-class did not copy
-- the immutable execution block into the release record. Only the exact current
-- approved version can be repaired from marketplace metadata.
update plugin_releases pr
set execution = pm.execution,
    manifest = pr.manifest || jsonb_build_object('execution', pm.execution),
    updated_at = now()
from plugin_marketplace pm
where pr.plugin_id = pm.plugin_id
  and pr.version = pm.version
  and pr.review_status = 'approved'
  and pr.execution is null
  and pm.execution is not null;

comment on column plugin_settings.profiles is
  'Ordered organization-scoped plugin configuration profiles matched per agent request.';
comment on column user_plugin_settings.profiles is
  'Ordered user-scoped plugin configuration profiles matched per agent request.';

