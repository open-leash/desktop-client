alter table evaluations
  add column if not exists resolution_payload jsonb;

comment on column evaluations.resolution_payload is
  'Structured human response returned to an agent-native interaction such as AskUserQuestion.';

grant select, insert, update, delete on evaluations to openleash;
