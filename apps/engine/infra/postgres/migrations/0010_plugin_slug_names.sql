update plugin_marketplace
set name = slug
where name is distinct from slug;

update plugin_submissions
set name = slug
where name is distinct from slug;

drop index if exists plugin_marketplace_search_idx;

create index if not exists plugin_marketplace_search_idx on plugin_marketplace using gin (
  to_tsvector('english', slug || ' ' || description || ' ' || short_description || ' ' || coalesce(tags::text, ''))
);
