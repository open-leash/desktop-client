# Open Source Boundary

This repository is the public OpenLeash core. It should be safe to publish.

## Public

Keep these parts open source:

- `apps/desktop-client`
- `apps/mobile-client`
- `apps/client-api`
- `apps/dashboard-api`
- `apps/dashboard-web`
- `apps/docs-web`
- shared API contracts
- schema and migrations
- self-host deployment paths
- managed self-host identity setup for Google Workspace, Okta, Ping, Microsoft Entra ID / Azure AD, generic OIDC, and LDAP / Active Directory-style directory sync
- provider interfaces and public default providers

## Private

Keep OpenLeash-operated SaaS code outside this repo:

- hosted tenant provisioning
- billing, subscriptions, invoices, quotas, and plan enforcement
- SaaS abuse controls and production rate limits
- production model-provider credentials
- proprietary hosted detection/evaluation adapters
- production update/signing credentials
- production cloud infrastructure and operations automation
- internal support/admin tools
- OpenLeash-operated cloud management UI and APIs that are not needed for self-hosted operation

## Rule

The public repo may know that a managed cloud mode exists. It must not contain the implementation of the OpenLeash-operated cloud business.

Use provider interfaces and composition:

```ts
createClientApi({
  tenantResolver,
  authProvider,
  billingProvider,
  evaluationProvider,
  notificationProvider,
  releaseProvider
});
```

Public defaults should be enough for managed self-hosted. The private cloud repo should inject OpenLeash-operated providers without changing public product semantics.

## Guardrail

Run `npm run audit:public` before release and in CI. The audit enforces that:

- public workspaces do not depend on `@openleash-private/*`
- private cloud wrappers stay outside the root public workspaces
- cloud wrappers are marked private and named `@openleash-private/*`
- public runtime code does not import `apps/cloud-*`
- public `client-api` and `dashboard-api` implementation code does not add hosted billing, subscription, quota, plan-enforcement, SaaS abuse, or production rate-limit logic

It is okay for public docs, product contracts, and UI copy to describe OpenLeash Cloud. The implementation of OpenLeash-operated SaaS mechanics belongs in the cloud wrappers or the private cloud repository.

## Local Cloud Simulation

`npm run dev:mode:cloud` is intentionally a simulation. It runs thin local cloud wrappers over the public core with cloud-compatible settings so development stays easy. It is not the private hosted platform, and OpenLeash-operated SaaS adapters still belong outside the public repo.
