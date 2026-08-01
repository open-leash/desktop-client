alter table plugin_settings
  add column if not exists installed_version text,
  add column if not exists update_policy text not null default 'manual';

alter table user_plugin_settings
  add column if not exists installed_version text,
  add column if not exists update_policy text not null default 'manual';

alter table plugin_settings
  drop constraint if exists plugin_settings_update_policy_check,
  add constraint plugin_settings_update_policy_check
    check (update_policy in ('manual', 'patch', 'minor', 'locked'));

alter table user_plugin_settings
  drop constraint if exists user_plugin_settings_update_policy_check,
  add constraint user_plugin_settings_update_policy_check
    check (update_policy in ('manual', 'patch', 'minor', 'locked'));

update plugin_settings ps
set installed_version = pm.version
from plugin_marketplace pm
where ps.plugin_id = pm.plugin_id
  and ps.installed_version is null;

update user_plugin_settings ups
set installed_version = pm.version
from plugin_marketplace pm
where ups.plugin_id = pm.plugin_id
  and ups.installed_version is null;
