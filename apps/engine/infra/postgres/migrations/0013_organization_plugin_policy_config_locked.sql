alter table organization_plugin_policy
  add column if not exists config_locked boolean not null default false;
