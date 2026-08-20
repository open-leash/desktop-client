create table if not exists plugin_marketplace (
  plugin_id text primary key,
  slug text not null unique,
  name text not null,
  description text not null,
  version text not null,
  publisher text not null,
  developer_name text not null,
  developer_url text,
  source text not null default 'community',
  review_status text not null default 'pending_review',
  short_description text not null,
  long_description text not null,
  hero_tagline text not null,
  package_url text,
  repository_url text,
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
  install_count integer not null default 0,
  rating numeric(2,1) not null default 0,
  featured_rank integer,
  seo_title text not null,
  seo_description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plugin_marketplace_source_check check (source in ('first_party', 'community', 'private')),
  constraint plugin_marketplace_review_check check (review_status in ('approved', 'pending_review', 'rejected'))
);

create index if not exists plugin_marketplace_search_idx on plugin_marketplace using gin (
  to_tsvector('english', slug || ' ' || description || ' ' || short_description || ' ' || coalesce(tags::text, ''))
);
create index if not exists plugin_marketplace_featured_idx on plugin_marketplace(featured_rank) where featured_rank is not null;
create index if not exists plugin_marketplace_review_idx on plugin_marketplace(review_status);

create table if not exists organization_plugin_policy (
  organization_id uuid references organizations(id) on delete cascade,
  plugin_id text not null references plugin_marketplace(plugin_id) on delete cascade,
  mandatory boolean not null default false,
  default_enabled boolean not null default false,
  user_install_allowed boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, plugin_id)
);

create index if not exists organization_plugin_policy_org_idx on organization_plugin_policy(organization_id, plugin_id);

create table if not exists organization_plugin_marketplace_policy (
  organization_id uuid primary key references organizations(id) on delete cascade,
  allow_user_marketplace_installs boolean not null default true,
  allow_user_community_plugins boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists plugin_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  submitted_by uuid references users(id) on delete set null,
  plugin_id text not null,
  slug text not null,
  name text not null,
  developer_name text not null,
  package_url text,
  repository_url text,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'pending_review',
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plugin_submissions_status_check check (status in ('pending_review', 'approved', 'rejected'))
);

create index if not exists plugin_submissions_status_idx on plugin_submissions(status, created_at desc);
