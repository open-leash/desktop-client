insert into plugin_settings (organization_id, plugin_id, enabled, config, ordering_priority, updated_at)
select organization_id, 'openleash.rules-enforcer', enabled, config, ordering_priority, now()
from plugin_settings
where plugin_id = 'openleash.security-evaluator'
on conflict (organization_id, plugin_id) do nothing;

insert into user_plugin_settings (user_id, organization_id, plugin_id, enabled, config, ordering_priority, updated_at)
select user_id, organization_id, 'openleash.rules-enforcer', enabled, config, ordering_priority, now()
from user_plugin_settings
where plugin_id = 'openleash.security-evaluator'
on conflict (user_id, plugin_id) do nothing;
