# OpenLeash Product Architecture

`docs/Product.md` is the product source of truth. This file is the implementation contract.

## Modes

OpenLeash supports three backend-backed modes:

- Individual Open Source: local `desktop-client`, local `client-api`, local Postgres, one local user.
- Private Cloud: customer-hosted `client-api`, `dashboard-api`, `dashboard-web`, and Postgres.
- OpenLeash Cloud: OpenLeash-hosted wrappers around the public core plus private SaaS adapters.

Desktop always requires a backend. In cloud/private modes it also exposes a thin local `client-api` edge surface for provider-proxy traffic and container plugins; this is not a standalone backend or source of truth.

## One Client API

`client-api` remains one published service for all modes. Do not fork it into a separate individual API and organization API.

Mode behavior is selected by product-mode capabilities inside the service:

- core runtime: hooks, evaluation, plugin execution, plugin settings, approvals, outcomes, client state, model-provider config, public plugin catalog reads, desktop update metadata.
- single-user runtime: one local user and one local organization record used only as backend scope; no dashboard, user directory, deployment tokens, SSO, billing, or fleet admin.
- organization runtime: dashboard API, user management, deployment tokens, identity providers, org policy, fleet visibility, audit views, admin plugin policy.
- OpenLeash Cloud runtime: hosted tenancy and SaaS adapters on top of the same core runtime.

Implementation source of truth: `apps/client-api/src/product-mode.ts`.

## Public Core Boundary

The public repo contains:

- `apps/desktop-client`
- `apps/mobile-client`
- `apps/client-api`
- `apps/dashboard-api`
- `apps/dashboard-web`
- `apps/docs-web`
- shared contracts, schema, migrations, deployment, and extension interfaces

The private OpenLeash Cloud layer contains only hosted SaaS details:

- tenant provisioning
- billing, plans, quotas
- abuse/rate-limit systems
- proprietary hosted detection/evaluation adapters, if any
- production signing, push, release, support, and ops tooling

Do not hide private SaaS implementation in public code behind environment flags.

## Composition Rule

Prefer providers over forks:

```ts
createClientApi({
  tenantResolver,
  authProvider,
  evaluationProvider,
  billingProvider,
  notificationProvider,
  auditSink,
  releaseProvider
});
```

Public providers must fully support Individual Open Source and Private Cloud. Cloud wrappers can compose private providers:

- `cloud-client-api` wraps public `client-api`.
- `cloud-dashboard-api` wraps public `dashboard-api`.
- `cloud-dashboard-web` wraps public `dashboard-web`.

The private repo may import the public repo. The public repo must not import private packages.

## Hook Direction

Installed hooks call the configured `client-api` directly:

```text
https://api.openleash.com/v1/hooks/:agent/:event
```

- OpenLeash Cloud: OpenLeash-hosted API.
- Private Cloud: customer-hosted `client-api`.
- Individual Open Source: local `client-api`, usually `http://127.0.0.1:9318`.

The desktop local API also owns the authenticated loopback provider-transform contract used by `local-proxy`. It invokes enabled edge plugin containers and relays enforcement/audit events to the configured managed backend. It is not the canonical installed hook target; hooks remain direct because cloud-run agents cannot reach localhost.

If the configured backend is unavailable, protected hooks fail closed with a clear backend-unavailable message.

## Naming

- `desktop-client`: tray app, local helper API, deployment CLI, hook installer.
- `mobile-client`: iOS/Android approval companion.
- `client-api`: client-facing API for hooks, evaluation, mobile, enrollment, updates.
- `dashboard-api`: admin/dashboard API.
- `dashboard-web`: signed-in web product surface.
- `docs-web`: docs site.
- `main-web`: marketing/product website.

## Development Modes

Local development mirrors product modes:

- Individual Open Source: `npm run dev:mode:individual-open-source`
  - Starts Postgres, migrations, one local account, `client-api`, and `desktop-client`.
- Private Cloud: `npm run dev:mode:self-hosted`
  - Starts Postgres, migrations, private dev org, `client-api`, `dashboard-api`, `dashboard-web`, and `desktop-client`.
- OpenLeash Cloud: `npm run dev:mode:cloud`
  - Starts Postgres, migrations, cloud dev org, `cloud-client-api`, `cloud-dashboard-api`, `cloud-dashboard-web`, and `desktop-client`.

## Checklist

Before accepting a structural change:

- Individual Open Source still uses real `client-api` and Postgres, not SQLite or a desktop-only backend.
- Private Cloud works without OpenLeash-operated SaaS.
- OpenLeash Cloud adds private adapters, not different core semantics.
- Hooks call the configured `client-api`.
- Public docs do not imply standalone desktop mode.
- Product-mode capability changes are reflected in `apps/client-api/src/product-mode.ts`.
