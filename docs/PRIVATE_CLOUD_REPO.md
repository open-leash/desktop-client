# Hosted Extension Boundary

Use a separate private repository for OpenLeash-operated hosted code. Keep it thin: it should compose the public core, not fork it.

Public customer-facing docs should not name private hosted projects, internal package names, production hostnames, or hosted operations runbooks. Customers need product flows: install clients, sign in, configure dashboard controls, issue deployment tokens, and roll out endpoints.

The private hosted layer may contain:

- tenant provisioning providers
- billing and plan providers
- abuse and rate-limit providers
- hosted evaluation providers
- production notification, update, release, and signing providers
- internal support and operations tooling
- deployment automation for OpenLeash-operated environments

The private repo should import or vendor the public repo, then inject private providers:

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

Do not copy large public apps into the private repo unless deployment packaging requires it. Prefer small composition layers that pass private providers/configuration into public app factories.

The public repo owns product contracts. The private repo owns OpenLeash-operated hosted business and production operations.

## Managed Self-Hosted Identity Stays Public

Enterprise identity is not a hosted-only feature. Managed self-hosted deployments need the classic customer-selected identity path:

- Google Workspace / Cloud Identity
- Okta
- Ping Identity
- Microsoft Entra ID / Azure AD
- Generic OpenID Connect providers such as Keycloak, Authentik, Auth0, and customer IdPs
- LDAP / Active Directory-style sync

The public dashboard onboarding and public API should remain capable of configuring these providers for self-hosted customers. The private hosted repo may add OpenLeash-operated defaults, tenant automation, support tools, and production credential handling, but it must not be required for a customer to connect their own identity provider.

Login and identity lifecycle should stay separate. For self-hosted customers, dashboard sign-in should use OIDC/OAuth with Authorization Code flow against the customer's issuer, while user and group lifecycle should come from Identity Loader, SCIM, or a directory connector. OpenLeash Cloud may keep hosted Google/Microsoft sign-up shortcuts in the private cloud layer, but the public core must remain usable with customer-owned issuers and directory sync.

## Dependency Direction

The private repo depends on the public repo. The public repo must not import private packages.

That direction keeps the public repo clean and makes the private repo small enough to maintain.
