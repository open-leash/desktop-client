# OpenLeash Installation

Pick the path that matches who owns the backend and who pays for LLM evaluation.

## Individual Open Source

For one technical user who does not want OpenLeash Cloud runtime.

- Install the OpenLeash desktop client.
- Choose **Individual Open Source** during setup.
- The installer checks Docker or another supported container runtime.
- The installer starts:
  - `client-api` in Docker
  - Postgres in Docker with persistent local storage
- No OpenLeash Cloud sign-in is required.
- Add your own LLM provider and API key.
- Desktop points to local `client-api`, usually `http://127.0.0.1:9318`.
- Agent hooks are installed against that local `client-api`.
- Plugins can be browsed from the public catalog, but installs and settings are saved locally.
- Backend updates pull newer Docker images and run migrations against local Postgres.

What OpenLeash Cloud is used for:

- Desktop app update feed
- Public plugin catalog browsing

What stays local:

- LLM key
- policy
- plugin install state
- approvals
- outcomes
- audit history

## Individual OpenLeash Cloud With Your LLM Key

For one user who wants OpenLeash hosted, but wants to use their own LLM provider key.

- Install the OpenLeash desktop client.
- Choose **Individual**.
- Choose **OpenLeash Cloud**.
- Sign in or create a personal OpenLeash account.
- Choose **Managed + Your LLM**.
- Add your LLM provider and API key.
- OpenLeash Cloud stores the key encrypted.
- Desktop points to OpenLeash Cloud `client-api`.
- Agent hooks call OpenLeash Cloud.
- Manage plugins, provider settings, approvals, and history from personal client surfaces.
- You do not enter the organization admin dashboard.

## Individual OpenLeash Cloud Fully Managed

For one user who wants OpenLeash Cloud to handle evaluation too.

- Install the OpenLeash desktop client.
- Choose **Individual**.
- Choose **OpenLeash Cloud**.
- Sign in or create a personal OpenLeash account.
- Choose **Fully Managed**.
- No LLM provider key is required.
- OpenLeash Cloud supplies evaluation.
- Desktop points to OpenLeash Cloud `client-api`.
- Agent hooks call OpenLeash Cloud.
- Manage plugins, approvals, and history from personal client surfaces.
- You do not enter the organization admin dashboard.

## Organization Private Cloud

For an organization that hosts OpenLeash in its own cloud or on-prem.

- Install the Private Cloud stack.
- Run:
  - `client-api`
  - `dashboard-api`
  - `dashboard-web`
  - Postgres
- Open the customer-hosted dashboard.
- Use the one-time deployment bootstrap value to create the first local recovery owner.
- Name the organization.
- Configure identity: Google Workspace, Okta, Ping, Microsoft Entra ID / Azure AD, LDAP / Active Directory-style sync, or local auth.
- Configure model-provider settings and LLM keys.
- Configure policies, plugins, approvals, audit, and deployment tokens.
- Distribute the desktop client to employees.
- Confirm a second workforce administrator can sign in, then rotate or remove the bootstrap value.
- Desktop clients point to the customer-hosted `client-api`.
- Mobile clients point to the customer-hosted `client-api` if used.
- Agent hooks call the customer-hosted `client-api`.
- Backend updates pull newer images/artifacts and run migrations with backup and rollback planning.

OpenLeash Cloud is not required for runtime.

## Organization OpenLeash Cloud With Your LLM Key

For an organization that wants OpenLeash hosted, but wants to use its own LLM provider key.

- Admin signs up for **Organization**.
- Choose **OpenLeash Cloud**.
- Choose **Managed + Your LLM**.
- OpenLeash creates or opens the hosted organization workspace.
- Admin continues setup in the hosted dashboard.
- Configure identity, users/groups, roles, policy, plugins, approvals, audit, and deployment tokens.
- Add the organization LLM provider and API key.
- OpenLeash Cloud stores the key encrypted.
- OpenLeash Cloud invokes evaluation against the chosen provider.
- Distribute the desktop client to employees.
- Employees sign in through the configured identity provider.
- Desktop and mobile clients point to OpenLeash Cloud.
- Agent hooks call OpenLeash Cloud.

## Organization OpenLeash Cloud Fully Managed

For an organization that wants OpenLeash Cloud to host everything and supply evaluation.

- Admin signs up for **Organization**.
- Choose **OpenLeash Cloud**.
- Choose **Fully Managed**.
- OpenLeash creates or opens the hosted organization workspace.
- Admin continues setup in the hosted dashboard.
- Configure identity, users/groups, roles, policy, plugins, approvals, audit, and deployment tokens.
- No organization LLM provider key is required.
- OpenLeash Cloud supplies evaluation.
- Distribute the desktop client to employees.
- Employees sign in through the configured identity provider.
- Desktop and mobile clients point to OpenLeash Cloud.
- Agent hooks call OpenLeash Cloud.

## Quick Decision

| User | Backend | LLM key | Dashboard |
| --- | --- | --- | --- |
| Individual Open Source | Local Docker `client-api` + Postgres | User key, local | No |
| Individual Cloud BYOK | OpenLeash Cloud | User key, encrypted in cloud | No org dashboard |
| Individual Cloud Fully Managed | OpenLeash Cloud | OpenLeash supplies evaluation | No org dashboard |
| Org Private Cloud | Customer-hosted stack | Organization key | Customer-hosted dashboard |
| Org Cloud BYOK | OpenLeash Cloud | Organization key, encrypted in cloud | Hosted dashboard |
| Org Cloud Fully Managed | OpenLeash Cloud | OpenLeash supplies evaluation | Hosted dashboard |
