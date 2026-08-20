-- Production role contract:
--   openleash_ops owns and migrates the schema (human/operations access).
--   openleash is the application runtime role.
--
-- Run production migrations as openleash_ops. Its default privileges below make
-- every future migration-created object usable by the runtime automatically.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'openleash') then
    execute format('grant connect on database %I to openleash', current_database());
    grant usage on schema public to openleash;
    grant select, insert, update, delete, truncate, references, trigger
      on all tables in schema public to openleash;
    grant usage, select, update on all sequences in schema public to openleash;
    grant execute on all routines in schema public to openleash;
  end if;

  if exists (select 1 from pg_roles where rolname = 'openleash_ops') then
    execute format('grant all privileges on database %I to openleash_ops', current_database());
    grant all privileges on schema public to openleash_ops;
    grant all privileges on all tables in schema public to openleash_ops;
    grant all privileges on all sequences in schema public to openleash_ops;
    grant all privileges on all routines in schema public to openleash_ops;

    alter default privileges for role openleash_ops in schema public
      grant select, insert, update, delete, truncate, references, trigger on tables to openleash;
    alter default privileges for role openleash_ops in schema public
      grant usage, select, update on sequences to openleash;
    alter default privileges for role openleash_ops in schema public
      grant execute on routines to openleash;
  end if;
end
$$;

comment on schema public is
  'Schema is migrated and administered by openleash_ops; openleash is the application runtime role.';
