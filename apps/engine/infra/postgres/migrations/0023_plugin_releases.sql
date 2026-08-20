create table if not exists plugin_releases (
  id uuid primary key default gen_random_uuid(),
  plugin_id text not null,
  version text not null,
  slug text not null,
  name text not null,
  description text not null,
  publisher text not null,
  developer_name text not null,
  developer_url text,
  source text not null default 'community',
  review_status text not null default 'pending_review',
  short_description text not null,
  long_description text not null,
  hero_tagline text not null,
  package_url text,
  repository_url text not null,
  documentation_url text,
  runtime text not null,
  entrypoint text not null,
  events jsonb not null default '[]'::jsonb,
  permissions jsonb not null default '[]'::jsonb,
  effects jsonb not null default '[]'::jsonb,
  ordering jsonb,
  config_schema jsonb,
  default_config jsonb not null default '{}'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  icon_text text not null default 'OL',
  visual_png text,
  git_ref text not null,
  commit_sha text,
  manifest_path text not null default 'openleash.plugin.json',
  manifest jsonb not null default '{}'::jsonb,
  submitted_by uuid references users(id) on delete set null,
  reviewed_by uuid references users(id) on delete set null,
  reviewer_note text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plugin_releases_source_check check (source in ('first_party', 'community', 'private')),
  constraint plugin_releases_review_check check (review_status in ('pending_review', 'approved', 'rejected', 'yanked')),
  unique(plugin_id, version)
);

create index if not exists plugin_releases_plugin_version_idx on plugin_releases(plugin_id, version);
create index if not exists plugin_releases_review_idx on plugin_releases(review_status, created_at desc);

insert into plugin_releases (
  plugin_id, version, slug, name, description, publisher, developer_name, developer_url,
  source, review_status, short_description, long_description, hero_tagline, package_url,
  repository_url, documentation_url, runtime, entrypoint, events, permissions, effects,
  ordering, config_schema, default_config, tags, icon_text, visual_png,
  git_ref, commit_sha, manifest_path, manifest, approved_at, created_at, updated_at
)
select
  pm.plugin_id, pm.version, pm.slug, pm.name, pm.description, pm.publisher, pm.developer_name, pm.developer_url,
  pm.source, 'approved', pm.short_description, pm.long_description, pm.hero_tagline, pm.package_url,
  coalesce(pm.repository_url, 'https://github.com/open-leash/plugin-' || pm.slug),
  pm.documentation_url, pm.runtime, pm.entrypoint, pm.events, pm.permissions, pm.effects,
  pm.ordering, pm.config_schema, pm.default_config, pm.tags, pm.icon_text, pm.visual_png,
  'marketplace-baseline', null, 'marketplace-baseline',
  jsonb_build_object(
    'id', pm.plugin_id,
    'slug', pm.slug,
    'name', pm.name,
    'description', pm.description,
    'version', pm.version,
    'publisher', pm.publisher,
    'runtime', pm.runtime,
    'entrypoint', pm.entrypoint,
    'events', pm.events,
    'permissions', pm.permissions,
    'effects', pm.effects,
    'ordering', pm.ordering,
    'configSchema', pm.config_schema,
    'defaultConfig', pm.default_config,
    'tags', pm.tags
  ),
  now(), pm.created_at, pm.updated_at
from plugin_marketplace pm
where pm.review_status = 'approved'
on conflict (plugin_id, version) do nothing;
