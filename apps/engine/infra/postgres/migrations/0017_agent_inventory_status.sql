alter table agent_runtimes add column if not exists installed boolean not null default true;
alter table agent_runtimes add column if not exists protected boolean not null default false;
alter table agent_runtimes add column if not exists detail text;
