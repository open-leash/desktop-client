# Leash Development North Star

Read this before changing architecture, package boundaries, deployment modes, or product flows.

## Canonical Product

`docs/Product.md` is the source of truth for the product contract and
`docs/USER_FLOWS.md` is the source of truth for onboarding and surface ownership.

Leash is an AI-agent safety product for individuals and businesses. The public
open-source repository ships the personal runtime plus public marketing and
pricing for every offer. It does not ship organization administration,
dashboards, dashboard APIs, identity-provider integrations, multi-tenant policy,
billing implementation, or a third-party extension marketplace.

## Public Product Offers

1. Personal, Free (BYOK)
   - Runs Leash Engine and Postgres for one person.
   - Uses the desktop client and optional mobile client.
   - Requires a user-supplied model-provider key.
   - Has no Leash account, hosted evaluation, billing, dashboard, organization,
     or identity-provider setup.

2. Personal, Leash Cloud
   - Runs the same personal client contract against the Leash-hosted API.
   - Costs $8 per month.
   - May offer Leash-managed evaluation.

3. Business, Leash Cloud
   - Costs $18 per user per month, or $14 per user per month with annual billing.
   - The public repository may market the plan and link into its hosted signup.
   - Business administration, tenancy, billing, identity, policy, and support
     tooling live outside this public repository.

Do not add a standalone desktop-only enforcement backend or a duplicate local
schema. Both modes use Leash Engine; Personal Open Source uses local Postgres.

## Public Repository Boundary

The public repository may contain:

- `apps/desktop`
- `apps/mobile`
- `apps/engine`, limited to personal client-facing behavior
- `apps/local-proxy`
- `apps/provider-sync-worker`
- `apps/flow-viewer`
- shared contracts, schema, personal deployment tooling, and built-in Features

The public docs site remains a separate public repository. The marketing site
and hosted-offer entry points are private deployments and are not part of this
runtime repository.

The public repository must not contain or publish:

- `apps/main-web` or `apps/docs-web`; marketing is private and docs are separate
- `dashboard-api` or `dashboard-web`
- identity-provider or directory-sync implementations
- organization administration, CISO consoles, or multi-tenant control planes
- plugin upload, publisher, download-count, marketplace, or community discovery
  systems

Private Leash Cloud code may depend on this public core. The public core must not
import private packages.

## Features

“Feature” is the product term for a built-in Leash capability such as Data
Leakage Prevention, Rules Enforcer, or MCP Scanner.

- Features are authored, reviewed, and shipped only by the Leash team.
- Features execute in-process in the Node.js Leash Engine runtime.
- Feature logic is registered through typed manifests and handlers so adding a
  first-party Feature remains straightforward.
- Feature execution must not require Docker, a sandbox container, image pulls,
  runtime secrets, a marketplace install, or a network gateway.
- Keep capability checks, event subscriptions, ordering, settings schemas,
  outcomes, and versioned contracts.
- There is no third-party upload or arbitrary-code-loading path.

For compatibility, existing database columns, package scopes, environment
variables, stable IDs such as `openleash.dlp`, and versioned routes such as
`/v1/plugins` may remain until a deliberate migration removes them. New UI,
documentation, logs, and API descriptions call these objects Features. Do not
expose compatibility fields such as publisher or download count in product UI.

## Naming

The product name shown to users is **Leash**. Existing bundle identifiers,
GitHub organization names, package scopes, domains, environment variables, and
on-disk compatibility paths may retain `OpenLeash`/`openleash` where renaming
would break installed clients or integrations. New user-facing copy must use
Leash.

## Development

- Personal Open Source: `npm run dev:mode:individual-open-source`
- Leash Cloud client stack: `npm run dev:mode:cloud`

The local open-source backend may use Docker for Postgres/service packaging.
That is independent of Feature execution: Features always run in-process in
Leash Engine and never require their own containers.

## Hook Direction

Installed hooks call the configured Leash Engine API directly:

```text
https://api.openleash.com/v1/hooks/:agent/:event
```

Personal Open Source uses its local Engine, normally
`http://127.0.0.1:9318`. Cloud-run agent environments cannot reach loopback
unless the user deliberately exposes the backend.

## Design Checks

Before shipping a change, verify:

1. Does Personal Open Source work without Leash Cloud?
2. Are public runtime surfaces free of dashboard/identity/admin code, with any
   Business offer limited to marketing, pricing, and a private-cloud handoff?
3. Does every built-in Feature execute in-process through the typed registry?
4. Are legacy plugin names confined to compatibility contracts?
5. Can a Leash developer add and test a Feature without Docker?
