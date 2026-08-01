# OpenLeash

OpenLeash protects AI agents through native local hooks and external-agent conversation sync. It is not a kernel sandbox. It is an enforcement and evidence layer that sees prompts, tool calls, conversations, and agent activity, evaluates them against rules, and either allows, denies, or asks the user.

OpenLeash has three backend-backed product modes:

- **Individual Open Source**: the real open-source `client-api` and Postgres run locally for one user. It has no OpenLeash Cloud sign-in or hosted billing, and the user supplies their own evaluation provider and key.

- **Private Cloud**: customer-hosted `client-api`, `dashboard-api`, and `dashboard-web` with customer-owned Postgres. Desktop and mobile clients talk to the customer's API, and evaluation can use the customer's own LLM provider/key.
- **Managed OpenLeash Cloud**: clients talk to OpenLeash-hosted public APIs such as `api.openleash.com`, admins use the hosted dashboard, and OpenLeash-operated SaaS adapters handle hosted tenancy, billing, abuse controls, production credentials, and cloud ops. Individual BYOK is free, individual managed evaluation is $8/month, organization BYOK is free up to 5 users and then $5/user/month after that, and organization managed evaluation is $12/user/month from the first user.

`docs/Product.md` is the source of truth for product modes, packages, and release expectations. `docs/USER_FLOWS.md` is the source of truth for onboarding and routing flows.

Local development ports are fixed in the 9000 range; see `docs/DEV_PORTS.md`.

## What is in this MVP

- `apps/client-api`: Express + Postgres client-facing managed API for self-hosted and cloud deployments. Clients can send normalized `POST /v1/evaluate` envelopes, mobile/desktop clients use the `/v1/*` client endpoints, and desktop updates use `/api/updates/*`.
- `apps/dashboard-api`: Express + Postgres dashboard/admin API. The dashboard uses this for admin views, auth, organizations, onboarding, policies, and deployment tokens.
- `apps/desktop-client` / `@openleash/desktop-client`: OpenLeash Desktop Client. It owns the tray, approval UI, deployment CLI, hook installer flow, local proxy edge, and updates. Installed hooks target the configured managed `client-api`; Individual Open Source uses its local `client-api`. Protected hooks fail closed if that backend is unavailable.
- `apps/mobile-client`: OpenLeash Mobile Client for iOS and Android. It connects to Cloud or a custom OpenLeash API, signs in through the configured identity provider, and handles approval notifications.
- `apps/dashboard-web`: Next.js CISO dashboard for computers, users, agents, policies, decisions, and recent activity.
- `infra/postgres/schema.sql`: canonical Postgres schema and starter policies.
- `infra/postgres/migrations/`: shipped Postgres migrations applied by `python3 migrate.py`.
- `docs/MIGRATION_WORKFLOW.md`: snapshot, migration, backup, and release-prep workflow.

See:

- `docs/PRODUCT_ARCHITECTURE.md`
- `docs/USER_FLOWS.md`
- `docs/OPEN_SOURCE_BOUNDARY.md`
- `docs/PRIVATE_CLOUD_REPO.md`
- `docs/EDITIONS.md`
- `docs/DEPLOYMENT.md`
- `docs/DATA_MODEL.md`
- `docs/EXTERNAL_AGENTS.md`
- `docs/MOBILE_CLIENT.md`

## Quick start

Install dependencies:

```bash
npm install
```

Run one of the product modes:

```bash
npm run dev:mode:individual-open-source
npm run dev:mode:self-hosted
npm run dev:mode:cloud
```

All three development modes start Postgres and run migrations. Individual Open Source starts the single-user `client-api` and desktop client. Private Cloud and OpenLeash Cloud also seed an organization and start their applicable APIs and dashboard.

## Self-Hosted Database Setup

Private Cloud / self-hosted installs use a customer-owned Postgres database. The API does not create or migrate schema during startup; run migrations as an explicit install or upgrade step before starting API workloads.

Fresh database:

```bash
python3 migrate.py --target custom --database-url 'postgres://...' --scope core --apply --yes
```

Upgrade to a newer OpenLeash version:

```bash
python3 migrate.py --target custom --database-url 'postgres://...' --scope core --backup-apply --yes
```

Check migration state without changing the DB:

```bash
python3 migrate.py --target custom --database-url 'postgres://...' --scope core --status --yes
```

In Kubernetes or similar platforms, run this as a one-shot Job or pre-upgrade hook. Start or roll API deployments only after the migration job succeeds.

VS Code Run and Debug exposes the same backend-backed entries:

- `OpenLeash: Private Cloud`
- `OpenLeash: OpenLeash Cloud`

Start the iOS/Android companion app:

```bash
npm run mobile-client
```

The tray icon turns green when connected, amber when approvals are waiting, and red when the configured backend is unreachable. Cloud and Private Cloud hooks call their managed `client-api`; Individual Open Source hooks call its local backend. Protected hooks fail closed when the required backend is unavailable.

## Evaluation model

Set `OPENAI_API_KEY` to use OpenAI policy evaluation in development. Managed deployments should configure evaluation through OpenLeash Cloud or the Private Cloud backend.

## Hook coverage notes

OpenLeash currently installs and evaluates native hook adapters for Claude Code, OpenAI Codex, Cursor, Gemini CLI, OpenCode, OpenClaw, and NanoClaw. Cline, Continue, and Windsurf are detected for inventory, but they are not marked fully protected until a stable approval-hook contract is implemented.
