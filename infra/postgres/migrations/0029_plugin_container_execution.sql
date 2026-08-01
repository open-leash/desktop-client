alter table plugin_marketplace
  add column if not exists execution jsonb;

alter table plugin_releases
  add column if not exists execution jsonb;

comment on column plugin_marketplace.execution is
  'Versioned container execution contract. Runtime endpoints and secrets are operator configuration and are never stored here.';
