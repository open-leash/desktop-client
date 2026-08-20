alter table skills
  add column if not exists content text,
  add column if not exists content_preview text,
  add column if not exists purpose_summary text,
  add column if not exists content_updated_at timestamptz;

alter table skill_events
  add column if not exists purpose_summary text;
