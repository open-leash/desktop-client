alter table plugin_marketplace
  add column if not exists download_count integer not null default 0,
  add column if not exists weekly_download_count integer not null default 0,
  add column if not exists trend_percent integer not null default 0;

alter table organization_plugin_marketplace_policy
  alter column allow_user_community_plugins set default true;
