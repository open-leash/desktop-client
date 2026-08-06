# Installing Leash

Leash is a personal product with two supported connection modes.

## Leash Cloud

1. Download the signed desktop build from `https://openleash.com`.
2. Sign in to your personal account in the desktop app.
3. Select the coding agents to monitor.
4. Choose and configure the built-in Features you want enabled.
5. Finish setup. Leash installs the selected hooks, configures the local proxy where supported, verifies the Feature registry, and starts monitoring.

No dashboard, organization, SSO, deployment-token, or marketplace flow is part of this installation.

## Personal Open Source

Requirements are Node.js 20+, npm, and Docker for Postgres. Features themselves do not use Docker.

```bash
python3 run.py --mode individual-open-source --clean-slate --yes
```

The runner starts Postgres, migrates the real `client-api` schema, bootstraps one local user, builds the desktop app, verifies every built-in Feature handler, and opens Leash. No Leash Cloud account is required. Supply your own supported model-provider key for model-assisted evaluation.

Use `python3 run.py --view-flow` to reopen the local flow viewer. Use `python3 run.py --delete-local --yes` to remove the local runtime and restore managed agent configuration.

## Compatibility names

Existing `openleash.*` Feature IDs, `OPENLEASH_*` environment variables, hooks, and `/v1/plugins` routes remain stable compatibility contracts. Product-facing surfaces call them Leash and Features.
