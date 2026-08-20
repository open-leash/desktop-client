-- Preserve existing policies and deployment tokens when upgrading a genuinely
-- single-tenant installation. In a multi-tenant database there is no safe owner
-- to infer, so legacy unowned rows remain quarantined from scoped APIs.
update policies
set organization_id = (select id from organizations limit 1)
where organization_id is null
  and (select count(*) from organizations) = 1;

update deployment_tokens
set organization_id = (select id from organizations limit 1)
where organization_id is null
  and (select count(*) from organizations) = 1;
