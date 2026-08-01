# OpenLeash Modes

OpenLeash is developed as one public core with three backend-backed deployment modes. The public repo should stay useful without any OpenLeash-operated SaaS code, but the desktop client always requires a backend: Individual Open Source, OpenLeash Cloud, or a customer-hosted Private Cloud backend.

## Individual Open Source

For indie developers and technical users who want OpenLeash fully independent from OpenLeash Cloud.

- Runs `desktop-client`, the real open-source `client-api`, and Postgres locally, usually through Docker with persistent volumes.
- There is no OpenLeash Cloud sign-in, hosted account, billing, or OpenLeash-managed evaluation.
- The user supplies their own LLM provider/key.
- Hooks call the locally running `client-api`.
- This mode must remain backend-backed and must not use SQLite, a desktop-only standalone backend, or a partial duplicate backend.

## Managed Self-Hosted

For teams that run OpenLeash on-prem or in a private cloud.

- Runs `desktop-client`, optional `mobile-client`, `client-api`, `dashboard-api`, `dashboard-web`, and Postgres.
- Clients talk to the customer-hosted `client-api`.
- Admins use the customer-hosted dashboard.
- The customer chooses the identity provider: Google Workspace, Okta, Ping, Microsoft Entra ID / Azure AD, or LDAP / Active Directory-style sync.
- Policy, audit, users, approvals, model-provider configuration, and deployment tokens are owned by the customer.
- This mode must remain fully open source.

## Managed OpenLeash Cloud

For the OpenLeash-operated hosted service.

- Uses the same public clients and core API contracts.
- OpenLeash-hosted endpoints can run the same public core.
- Hosted tenancy, billing, plan enforcement, abuse controls, production credentials, signing infrastructure, and cloud operations belong in a private OpenLeash Cloud composition layer.

The public repo may include cloud-compatible contracts and local simulation. It must not include private SaaS implementation details.

## Shared Runtime

All modes share:

- OpenLeash Desktop Client
- configured `client-api` hook direction
- agent adapter registry
- approval popup
- mobile approval contract
- update contract
- event envelope
- policy decision model
- self-hostable API and dashboard surfaces

## Storage Contract

- Managed Self-Hosted: customer-managed Postgres.
- Managed OpenLeash Cloud: OpenLeash-managed infrastructure in the private hosted deployment.
- Individual Open Source: local Postgres with persistent volumes/backups.
