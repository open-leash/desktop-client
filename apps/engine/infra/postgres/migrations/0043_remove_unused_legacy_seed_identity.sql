do $$
declare
  legacy_user_id uuid;
  legacy_organization_id uuid;
  child_table regclass;
  child_column text;
  has_related_rows boolean;
begin
  select u.id
  into legacy_user_id
  from users u
  join organizations o on o.id = u.organization_id
  where u.email = 'max.brin@openleash.local'
    and u.display_name = 'Max Brin'
    and u.role = 'owner'
    and o.slug = 'openleash'
    and o.name = ''
    and o.setup_completed = false
  limit 1;

  if legacy_user_id is not null then
    has_related_rows := false;
    for child_table, child_column in
      select constraint_row.conrelid::regclass, attribute_row.attname
      from pg_constraint constraint_row
      join pg_attribute attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = constraint_row.conkey[1]
      where constraint_row.contype = 'f'
        and constraint_row.confrelid = 'users'::regclass
        and cardinality(constraint_row.conkey) = 1
    loop
      execute format(
        'select exists (select 1 from %s where %I = $1)',
        child_table,
        child_column
      ) into has_related_rows using legacy_user_id;
      exit when has_related_rows;
    end loop;

    if not has_related_rows then
      delete from users where id = legacy_user_id;
    end if;
  end if;

  select id
  into legacy_organization_id
  from organizations
  where slug = 'openleash'
    and name = ''
    and setup_completed = false
    and current_step = 1
  limit 1;

  if legacy_organization_id is not null then
    has_related_rows := false;
    for child_table, child_column in
      select constraint_row.conrelid::regclass, attribute_row.attname
      from pg_constraint constraint_row
      join pg_attribute attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = constraint_row.conkey[1]
      where constraint_row.contype = 'f'
        and constraint_row.confrelid = 'organizations'::regclass
        and cardinality(constraint_row.conkey) = 1
    loop
      execute format(
        'select exists (select 1 from %s where %I = $1)',
        child_table,
        child_column
      ) into has_related_rows using legacy_organization_id;
      exit when has_related_rows;
    end loop;

    if not has_related_rows then
      delete from organizations where id = legacy_organization_id;
    end if;
  end if;
end
$$;
