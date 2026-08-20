insert into plugin_marketplace (
  plugin_id, slug, name, description, version, publisher, developer_name, developer_url,
  source, review_status, short_description, long_description, hero_tagline, package_url,
  repository_url, documentation_url, runtime, entrypoint, events, permissions, effects,
  ordering, config_schema, default_config, tags, icon_text, visual_png, featured_rank,
  seo_title, seo_description, created_at, updated_at
)
select
  'openleash.code-scanner', 'code-scanner', 'code-scanner', description, version, publisher,
  developer_name, developer_url, source, review_status, short_description, long_description,
  hero_tagline,
  replace(coalesce(package_url, ''), 'dangerous-code', 'code-scanner'),
  'https://github.com/open-leash/plugin-code-scanner',
  replace(coalesce(documentation_url, ''), 'dangerous-code', 'code-scanner'),
  runtime, 'plugins/code-scanner', events, permissions, effects, ordering, config_schema,
  default_config, tags, icon_text, visual_png, featured_rank,
  replace(seo_title, 'dangerous-code', 'code-scanner'),
  replace(seo_description, 'dangerous-code', 'code-scanner'), created_at, now()
from plugin_marketplace
where plugin_id = 'openleash.dangerous-code'
on conflict (plugin_id) do nothing;

insert into plugin_settings (
  organization_id, plugin_id, enabled, config, ordering_priority, installed_version, update_policy, updated_at
)
select organization_id, 'openleash.code-scanner', enabled, config, ordering_priority, installed_version, update_policy, updated_at
from plugin_settings where plugin_id = 'openleash.dangerous-code'
on conflict (organization_id, plugin_id) do update set
  enabled = excluded.enabled,
  config = excluded.config,
  ordering_priority = excluded.ordering_priority,
  installed_version = excluded.installed_version,
  update_policy = excluded.update_policy,
  updated_at = excluded.updated_at;

insert into user_plugin_settings (
  user_id, organization_id, plugin_id, enabled, config, ordering_priority, installed_version, update_policy, updated_at
)
select user_id, organization_id, 'openleash.code-scanner', enabled, config, ordering_priority, installed_version, update_policy, updated_at
from user_plugin_settings where plugin_id = 'openleash.dangerous-code'
on conflict (user_id, plugin_id) do update set
  enabled = excluded.enabled,
  config = excluded.config,
  ordering_priority = excluded.ordering_priority,
  installed_version = excluded.installed_version,
  update_policy = excluded.update_policy,
  updated_at = excluded.updated_at;

insert into plugin_state (
  organization_id, plugin_id, scope_key, state_key, value, expires_at, created_at, updated_at
)
select organization_id, 'openleash.code-scanner', scope_key, state_key, value, expires_at, created_at, updated_at
from plugin_state where plugin_id = 'openleash.dangerous-code'
on conflict (organization_id, plugin_id, scope_key, state_key) do update set
  value = excluded.value,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at;

insert into organization_plugin_policy (
  organization_id, plugin_id, mandatory, default_enabled, user_install_allowed, config_locked, updated_at
)
select organization_id, 'openleash.code-scanner', mandatory, default_enabled, user_install_allowed, config_locked, updated_at
from organization_plugin_policy where plugin_id = 'openleash.dangerous-code'
on conflict (organization_id, plugin_id) do update set
  mandatory = excluded.mandatory,
  default_enabled = excluded.default_enabled,
  user_install_allowed = excluded.user_install_allowed,
  config_locked = excluded.config_locked,
  updated_at = excluded.updated_at;

update plugin_log_events set plugin_id = 'openleash.code-scanner' where plugin_id = 'openleash.dangerous-code';
update plugin_signals set plugin_id = 'openleash.code-scanner' where plugin_id = 'openleash.dangerous-code';
update plugin_usage_records set plugin_id = 'openleash.code-scanner' where plugin_id = 'openleash.dangerous-code';

update plugin_submissions
set plugin_id = 'openleash.code-scanner',
    slug = 'code-scanner',
    name = 'code-scanner',
    package_url = replace(coalesce(package_url, ''), 'dangerous-code', 'code-scanner'),
    repository_url = 'https://github.com/open-leash/plugin-code-scanner',
    manifest = replace(manifest::text, 'dangerous-code', 'code-scanner')::jsonb,
    updated_at = now()
where plugin_id = 'openleash.dangerous-code';

update plugin_releases
set plugin_id = 'openleash.code-scanner',
    slug = 'code-scanner',
    name = 'code-scanner',
    package_url = replace(coalesce(package_url, ''), 'dangerous-code', 'code-scanner'),
    repository_url = 'https://github.com/open-leash/plugin-code-scanner',
    documentation_url = replace(coalesce(documentation_url, ''), 'dangerous-code', 'code-scanner'),
    entrypoint = 'plugins/code-scanner',
    manifest = replace(manifest::text, 'dangerous-code', 'code-scanner')::jsonb,
    updated_at = now()
where plugin_id = 'openleash.dangerous-code';

delete from plugin_settings where plugin_id = 'openleash.dangerous-code';
delete from user_plugin_settings where plugin_id = 'openleash.dangerous-code';
delete from plugin_state where plugin_id = 'openleash.dangerous-code';
delete from plugin_marketplace where plugin_id = 'openleash.dangerous-code';
