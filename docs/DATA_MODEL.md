# Data Model

## Desktop Local Cache

Desktop may cache endpoint-local state for UX and hook relay operation:

- setup state
- selected agents
- backend-managed rules snapshot
- pending approval snapshot
- highlighted action snapshot
- update state

The cache is not the source of truth for policy, evaluation, plugins, approvals, audit, or account state. Desktop clients require OpenLeash Cloud or a customer-hosted Private Cloud backend.

Older JSON stores can be migrated into local cache storage on first launch.

## OpenLeash Cloud

Cloud uses OpenLeash-managed Postgres.

Core tables:

- organizations
- users
- identity providers
- computers
- agent runtimes
- policies
- policy results
- conversation events
- evaluations
- deployment tokens
- installer versions
- update channels

## Private Cloud

Private Cloud uses the same schema as OpenLeash Cloud, but the customer operates Postgres.

Private Cloud deployments must support:

- customer-owned domain
- customer-owned Postgres
- SSO/OAuth
- tenant-scoped model keys
- update feed override
- retention policy

## Rule Ownership

OpenLeash Cloud and Private Cloud:

- admins own rules
- employees cannot change rules locally
- endpoints receive signed or tenant-authenticated policy bundles

## Identity

OpenLeash Cloud and Private Cloud support:

- Okta
- Google Workspace
- Microsoft Entra ID
- Generic OpenID Connect

Implementation target:

- OIDC/OAuth Authorization Code flow for dashboard and mobile sign-in
- SCIM, Identity Loader, or directory connectors for roster and group sync
- SAML through a customer IdP bridge when needed
