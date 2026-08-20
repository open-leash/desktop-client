alter table policies
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table deployment_tokens
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table policies drop constraint if exists policies_name_key;

create unique index if not exists policies_organization_name_unique_idx
  on policies(organization_id, name)
  where organization_id is not null;

create index if not exists policies_organization_created_idx
  on policies(organization_id, created_at asc);

create index if not exists deployment_tokens_organization_created_idx
  on deployment_tokens(organization_id, created_at desc);

-- Legacy single-user rows cannot be assigned safely when an upgraded database
-- contains multiple organizations. Unowned rows are intentionally invisible to
-- organization-scoped APIs and can be recreated in the correct tenant.
