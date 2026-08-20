-- Organizations must begin with no enforceable policy rules. Administrators
-- can import or scan agent instruction files and explicitly choose what to
-- enforce; generated templates must not silently become production policy.
with generated(name, natural_language_rule) as (
  values
    ('Filesystem destruction', 'Ask before allowing rm -rf /, rm -rf ., recursive deletion of the current project/workspace, deleting the project directory, or formatting local disks/volumes.'),
    ('Database destructive changes', 'Ask before allowing DROP DATABASE, DROP TABLE, DROP SCHEMA, TRUNCATE TABLE, or unfiltered DELETE FROM statements.'),
    ('Database mass update', 'Ask before allowing UPDATE statements that modify a table without an explicit WHERE clause.'),
    ('Cloud resource deletion', 'Ask before deleting S3 buckets, GCP projects, Kubernetes namespaces, VMs, DNS zones, CloudFormation stacks, storage accounts, or similar cloud resources.'),
    ('Terraform and Kubernetes destruction', 'Ask before terraform destroy, terraform apply -destroy, tofu destroy, kubectl delete namespace, helm uninstall, or equivalent destructive infrastructure operations.'),
    ('Git commit or push', 'Ask before agents run git commit, git push, gh repo sync, release upload, or otherwise publish commits without approval.'),
    ('Protected branch push', 'Ask before direct git pushes to main, master, trunk, production, prod, or release branches.'),
    ('Git history rewrite or cleanup', 'Ask before git push --force, git reset --hard, git clean -fdx, interactive rebase rewrites, git filter-branch, or similar history/worktree destructive commands.'),
    ('Committing secrets', 'Ask before committing staged content that appears to include .env values, private keys, access tokens, API keys, cloud credentials, or similar secrets.'),
    ('Dependency or lockfile changes', 'Ask before installing dependencies, upgrading packages, or modifying package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, poetry.lock, Cargo.lock, go.sum, .csproj, or similar manifests/lockfiles.'),
    ('Global package install', 'Ask before globally installing packages with npm, pnpm, yarn, pip, gem, cargo, go install, or similar package managers.'),
    ('Secrets and credentials access', 'Ask before reading, copying, printing, editing, exfiltrating, or summarizing .env files, SSH keys, cloud credentials, API tokens, browser cookies, kubeconfigs, npm tokens, or password stores.'),
    ('Personal data use', 'Ask before processing personal, customer, employee, passport, SSN, credit card, or similarly regulated data.'),
    ('External data sharing', 'Ask before uploading files, calling unknown external URLs, pasting logs to third-party services, sending source code, or exfiltrating secrets during debugging.')
)
delete from policies p
using generated g
where p.name = g.name
  and p.natural_language_rule = g.natural_language_rule
  and p.updated_at = p.created_at;
