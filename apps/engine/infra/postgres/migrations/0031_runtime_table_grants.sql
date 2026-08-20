do $$
begin
  if exists (select 1 from pg_roles where rolname = 'openleash') then
    grant select, insert, update, delete on table agent_monitoring_settings to openleash;
    grant select, insert, update, delete on table plugin_releases to openleash;
  end if;
end
$$;

comment on table agent_monitoring_settings is
  'Per-agent monitoring preferences. The application runtime role must be able to read and update these settings.';
