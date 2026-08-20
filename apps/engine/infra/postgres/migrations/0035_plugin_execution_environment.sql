alter table plugin_marketplace
  add column if not exists execution_environment text not null default 'any';

alter table plugin_releases
  add column if not exists execution_environment text not null default 'any';

alter table plugin_marketplace
  drop constraint if exists plugin_marketplace_execution_environment_check,
  add constraint plugin_marketplace_execution_environment_check
    check (execution_environment in ('any', 'cloud-only'));

alter table plugin_releases
  drop constraint if exists plugin_releases_execution_environment_check,
  add constraint plugin_releases_execution_environment_check
    check (execution_environment in ('any', 'cloud-only'));

comment on column plugin_marketplace.execution_environment is
  'Host-enforced product-mode placement declared by the reviewed plugin manifest.';

comment on column plugin_releases.execution_environment is
  'Immutable release placement: any public runtime or OpenLeash Cloud only.';
