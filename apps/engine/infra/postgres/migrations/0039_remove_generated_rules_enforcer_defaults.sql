-- Older desktop builds materialized the enabled core policy catalog into an
-- otherwise-empty Rules Enforcer configuration. Clear only that exact legacy
-- payload so fresh and upgraded installations start with no user-selected
-- rules. Any edited, reordered, added, or removed rule makes the JSON differ
-- and is therefore preserved.
with legacy_rules(value) as (
  values (
    '[
      {"text":"Ask before agents run git commit, git push, gh repo sync, release upload, or otherwise publish commits without approval.","action":"ask"},
      {"text":"Ask before installing dependencies, upgrading packages, or modifying package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, poetry.lock, Cargo.lock, go.sum, .csproj, or similar manifests/lockfiles.","action":"ask"},
      {"text":"Ask before processing personal, customer, employee, passport, SSN, credit card, or similarly regulated data.","action":"ask"},
      {"text":"Ask before allowing rm -rf /, rm -rf ., recursive deletion of the current project/workspace, deleting the project directory, or formatting local disks/volumes.","action":"ask"},
      {"text":"Ask before allowing DROP DATABASE, DROP TABLE, DROP SCHEMA, TRUNCATE TABLE, or unfiltered DELETE FROM statements.","action":"ask"},
      {"text":"Ask before allowing UPDATE statements that modify a table without an explicit WHERE clause.","action":"ask"},
      {"text":"Ask before deleting S3 buckets, GCP projects, Kubernetes namespaces, VMs, DNS zones, CloudFormation stacks, storage accounts, or similar cloud resources.","action":"ask"},
      {"text":"Ask before terraform destroy, terraform apply -destroy, tofu destroy, kubectl delete namespace, helm uninstall, or equivalent destructive infrastructure operations.","action":"ask"},
      {"text":"Ask before direct git pushes to main, master, trunk, production, prod, or release branches.","action":"ask"},
      {"text":"Ask before git push --force, git reset --hard, git clean -fdx, interactive rebase rewrites, git filter-branch, or similar history/worktree destructive commands.","action":"ask"},
      {"text":"Ask before committing staged content that appears to include .env values, private keys, access tokens, API keys, cloud credentials, or similar secrets.","action":"ask"},
      {"text":"Ask before globally installing packages with npm, pnpm, yarn, pip, gem, cargo, go install, or similar package managers.","action":"ask"},
      {"text":"Ask before reading, copying, printing, editing, exfiltrating, or summarizing .env files, SSH keys, cloud credentials, API tokens, browser cookies, kubeconfigs, npm tokens, or password stores.","action":"ask"},
      {"text":"Ask before uploading files, calling unknown external URLs, pasting logs to third-party services, sending source code, or exfiltrating secrets during debugging.","action":"ask"}
    ]'::jsonb
  )
)
update plugin_settings
set config = jsonb_set(config, '{rules}', '[]'::jsonb, true),
    updated_at = now()
from legacy_rules
where plugin_id = 'openleash.rules-enforcer'
  and config->'rules' = legacy_rules.value;

with legacy_rules(value) as (
  values (
    '[
      {"text":"Ask before agents run git commit, git push, gh repo sync, release upload, or otherwise publish commits without approval.","action":"ask"},
      {"text":"Ask before installing dependencies, upgrading packages, or modifying package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, poetry.lock, Cargo.lock, go.sum, .csproj, or similar manifests/lockfiles.","action":"ask"},
      {"text":"Ask before processing personal, customer, employee, passport, SSN, credit card, or similarly regulated data.","action":"ask"},
      {"text":"Ask before allowing rm -rf /, rm -rf ., recursive deletion of the current project/workspace, deleting the project directory, or formatting local disks/volumes.","action":"ask"},
      {"text":"Ask before allowing DROP DATABASE, DROP TABLE, DROP SCHEMA, TRUNCATE TABLE, or unfiltered DELETE FROM statements.","action":"ask"},
      {"text":"Ask before allowing UPDATE statements that modify a table without an explicit WHERE clause.","action":"ask"},
      {"text":"Ask before deleting S3 buckets, GCP projects, Kubernetes namespaces, VMs, DNS zones, CloudFormation stacks, storage accounts, or similar cloud resources.","action":"ask"},
      {"text":"Ask before terraform destroy, terraform apply -destroy, tofu destroy, kubectl delete namespace, helm uninstall, or equivalent destructive infrastructure operations.","action":"ask"},
      {"text":"Ask before direct git pushes to main, master, trunk, production, prod, or release branches.","action":"ask"},
      {"text":"Ask before git push --force, git reset --hard, git clean -fdx, interactive rebase rewrites, git filter-branch, or similar history/worktree destructive commands.","action":"ask"},
      {"text":"Ask before committing staged content that appears to include .env values, private keys, access tokens, API keys, cloud credentials, or similar secrets.","action":"ask"},
      {"text":"Ask before globally installing packages with npm, pnpm, yarn, pip, gem, cargo, go install, or similar package managers.","action":"ask"},
      {"text":"Ask before reading, copying, printing, editing, exfiltrating, or summarizing .env files, SSH keys, cloud credentials, API tokens, browser cookies, kubeconfigs, npm tokens, or password stores.","action":"ask"},
      {"text":"Ask before uploading files, calling unknown external URLs, pasting logs to third-party services, sending source code, or exfiltrating secrets during debugging.","action":"ask"}
    ]'::jsonb
  )
)
update user_plugin_settings
set config = jsonb_set(config, '{rules}', '[]'::jsonb, true),
    updated_at = now()
from legacy_rules
where plugin_id = 'openleash.rules-enforcer'
  and config->'rules' = legacy_rules.value;
