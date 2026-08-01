# OpenLeash Development North Star

Read this before changing architecture, package boundaries, deployment modes, or product flows.

## Canonical Platform Flows

The product source of truth lives in `docs/Product.md`. Product modes, package/pricing semantics, BYOK evaluation behavior, and release expectations must align with that file.

The canonical audience and onboarding flows live in `docs/USER_FLOWS.md`.

That file is the source of truth for:

- Solo Dev - Public Cloud
- Solo Dev - Individual Open Source
- Org Admin - Public Cloud
- Org Admin - Private Cloud

The most important invariant is: solo developers never see the dashboard. Desktop, mobile, and marketing can start solo public-cloud sign-up, but solo account creation completes in the same surface and stays out of the dashboard. Solo developers who choose Individual Open Source do not sign into OpenLeash Cloud.

## Product Modes

OpenLeash desktop-client requires a backend. Do not add or preserve a supported fully local/standalone desktop mode. Individual Open Source is allowed only when it runs the real open-source `client-api` and Postgres locally; it must not use SQLite, a partial desktop backend, or a forked execution path.

1. Individual Open Source (local open-source runtime for one user)
   - User installs `desktop-client`.
   - Installer or CLI runs the real open-source `client-api` and Postgres locally, usually through Docker with persistent volumes.
   - There is no OpenLeash Cloud sign-in, billing, hosted account, or OpenLeash-managed evaluation.
   - User supplies their own LLM provider and token for evaluations.
   - Desktop app updates still use the OpenLeash public update feed by default; local backend/container updates are separate.
   - Product-facing setup should call this **Individual Open Source**, not Private Cloud.
   - This mode must remain backend-backed: no SQLite, no standalone desktop-only backend, and no duplicated partial backend.

2. Private Cloud (managed self-hosted runtime)
   - User installs `desktop-client` and optionally `mobile-client`.
   - Clients talk to a customer-hosted `client-api`.
   - Admins use customer-hosted `dashboard-api` and `dashboard-web`.
   - Customer admins choose and configure their identity provider in the public core: Google Workspace, Okta, Ping, Microsoft Entra ID / Azure AD, or LDAP / Active Directory-style sync.
   - Policy, audit, users, approvals, and evaluation are managed centrally by the customer.
   - This mode must remain fully open-source and runnable on-prem or in a private cloud.
   - Product-facing setup should call this **Private Cloud**.

3. OpenLeash Cloud (managed hosted runtime)
   - User installs `desktop-client` and optionally `mobile-client`.
   - Desktop proxy traffic passes through the local `client-api` edge surface for container-plugin execution, then relays normalized enforcement to OpenLeash-hosted public API endpoints such as `api.openleash.com`. This edge surface is not a local backend or source of truth.
   - Hooks and SaaS/provider events without a desktop edge call the hosted `client-api` directly.
   - Admins use OpenLeash-hosted dashboard endpoints.
   - OpenLeash-operated SaaS adapters handle hosted tenancy, billing, abuse controls, production credentials, and cloud ops.
   - These SaaS adapters may live outside the public repo.
   - Solo users use OpenLeash Cloud without dashboard access. Organization admins are handed off to the dashboard after account creation.

## Open Source Boundary

The public repo should contain the core product:

- `apps/desktop-client`
- `apps/mobile-client`
- `apps/client-api`
- `apps/dashboard-api`
- `apps/dashboard-web`
- `apps/docs-web`
- shared contracts, schema, self-host deployment, and extension interfaces

The private OpenLeash Cloud layer should contain only OpenLeash-operated SaaS specifics:

- production tenant provisioning
- billing, subscriptions, quotas, and plan enforcement
- SaaS abuse prevention and rate-limit strategy
- proprietary detection or hosted evaluation adapters, if any
- production push/update/signing credential handling
- internal support, ops, and cloud admin tooling

Do not put truly private cloud logic in public code behind an environment flag. Flags hide execution, not source.

## Composition Rule

Prefer provider interfaces over forks or duplicated apps. Public code should expose boring default providers for managed self-hosted operation, while the private cloud layer can compose the same app with private providers.

Conceptually:

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

Public defaults should support managed self-hosted. Private OpenLeash Cloud code should provide only the OpenLeash-operated SaaS adapters.

Private cloud wrappers should be thin:

- `cloud-client-api` wraps public `client-api`.
- `cloud-dashboard-api` wraps public `dashboard-api`.
- `cloud-dashboard-web` wraps public `dashboard-web`.

The private repo depends on the public repo. The public repo must not import private packages.

Do not split `client-api` into separate individual and organization apps. Keep one published `openleash-client-api` service and split behavior by product-mode capabilities/providers inside the service. Individual Open Source enables the single-user core runtime. Private Cloud enables org/dashboard capabilities. OpenLeash Cloud composes hosted SaaS adapters around the same core runtime.

## Naming

- `desktop-client`: installed tray app, local API, hook installer, deployment CLI.
- `mobile-client`: iOS/Android approval companion.
- `client-api`: client-facing managed API for hooks, evaluations, mobile, enrollment, and updates.
- `dashboard-api`: admin/dashboard API surface.
- `dashboard-web`: admin/dashboard web app.
- `docs-web`: documentation web app.
- `main-web`: marketing/product website.

## Development Modes

Use backend-backed modes in local development and VS Code Run and Debug:

- Individual Open Source: `npm run dev:mode:individual-open-source`
- Private Cloud: `npm run dev:mode:self-hosted`
- OpenLeash Cloud: `npm run dev:mode:cloud`

Individual Open Source, Private Cloud, and OpenLeash Cloud use local Postgres in development by default. The mode runner starts `docker compose up -d postgres`, runs migrations, and seeds the appropriate local account or organization. Individual Open Source starts `client-api` and `desktop-client` for a single local user. Private Cloud starts `client-api`, `dashboard-api`, `dashboard-web`, and `desktop-client`. OpenLeash Cloud starts the thin cloud wrappers `cloud-client-api`, `cloud-dashboard-api`, `cloud-dashboard-web`, and `desktop-client`.

## Hook Direction

Installed hooks should call the configured managed OpenLeash API:

```text
https://api.openleash.com/v1/hooks/:agent/:event
```

Private Cloud deployments use the customer-hosted `client-api` URL instead of OpenLeash Cloud. This is required because agents such as Claude Code and Codex may move execution into a provider cloud while keeping the same configured hook URL; a localhost hook would no longer be reachable from that environment. The desktop local API may still exist for setup, tray state, OAuth callback handling, local development, and legacy/dev relay behavior, but it is not the canonical installed hook target. If the managed backend is unavailable, protected hooks should fail closed with a clear backend-unavailable message rather than falling back to local evaluation.

Individual Open Source installs use the locally running `client-api` URL as the hook target. This is acceptable because the user explicitly chose local-only operation. Cloud-run agent environments will not be able to reach that backend unless the user exposes it through a tunnel, VPN, LAN, or custom reachable URL.

## Design Bias

When adding a feature, ask:

1. Does managed self-hosted work without OpenLeash-operated SaaS?
2. Is OpenLeash Cloud only adding private adapters, not changing core product semantics?
3. Is this a provider interface instead of a hard-coded SaaS assumption?
4. For Individual Open Source, is the feature using the same backend, Postgres schema, plugin model, and migrations rather than creating a local fork?
