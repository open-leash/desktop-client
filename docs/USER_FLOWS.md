# OpenLeash User Flows

This is the canonical onboarding and routing contract. Product/package terms come from `docs/Product.md`.

## Invariants

- Solo developers never see the organization-admin/CISO dashboard.
- Solo public-cloud account creation finishes in the surface where it started: desktop, mobile, or web.
- Individual Open Source setup never requires OpenLeash Cloud sign-up.
- Employees do not run admin onboarding; they sign in through their organization identity provider.
- `dashboard-web` can render personal/employee client views, but org-admin/CISO areas require dashboard roles.
- Individual Open Source runs the real `client-api` and Postgres locally. It must not use SQLite, a desktop-only backend, or a partial duplicate backend.
- Desktop app updates use the OpenLeash public update feed by default. Backend/container updates are separate.
- Desktop installation does not finish until every enabled local plugin container and managed backend plugin runtime passes both health and signed protocol verification. A missing endpoint, bad runtime secret, unhealthy container, or incompatible response leaves setup incomplete with a per-plugin error.

## 1. Solo Dev - Public Cloud

Entry: marketing site, desktop client, or mobile client.

Flow:

1. User signs up with email, GitHub, or Google.
2. Account creation completes in the starting surface.
3. User is never redirected to org-admin/CISO setup.
4. Web/mobile surfaces prompt the user to install the desktop client to monitor agents.
5. User manages a personal account from desktop, mobile, or personal client web surfaces.

Rules:

- Individual BYOK: free. User supplies an LLM key; OpenLeash Cloud stores it encrypted and invokes evaluation against that provider.
- Individual Fully Managed: $8/month. OpenLeash Cloud supplies evaluation.
- Hooks call the OpenLeash-hosted `client-api`.
- Local LLM provider traffic uses `local-proxy -> desktop client-api edge -> enabled plugin containers -> provider`; the edge relays normalized enforcement to OpenLeash Cloud.
- If the backend is unavailable, protected hooks fail closed with a clear reconnect message.

## 2. Solo Dev - Individual Open Source

Entry: desktop installer, OpenLeash CLI, docs, or marketing download page.

Flow:

1. User chooses **Individual Open Source**.
2. Installer/CLI checks Docker or another supported container runtime.
3. Installer/CLI starts the real open-source `client-api` and Postgres with persistent storage.
4. Local backend bootstraps one local user/account without OpenLeash Cloud sign-up.
5. User enters their own LLM provider key.
6. Desktop uses the local `client-api`, usually `http://127.0.0.1:9318`.
7. Agent hooks are installed against the local `client-api`.
8. Installer verifies every enabled desktop-edge and local-backend plugin container through a signed protocol round-trip.
9. User manages plugins, provider settings, approvals, outcomes, and local backend updates from desktop and/or CLI. Enabled container plugins run through the same versioned container API, either beside the desktop edge for provider traffic or beside the local backend for direct hooks.

Rules:

- Product-facing name is **Individual Open Source**, not Private Cloud.
- OpenLeash Cloud is not required for runtime, account state, evaluation, plugin installation state, approvals, audit history, or policy.
- Desktop/CLI may read the public OpenLeash plugin catalog; installs/settings are written to local `client-api`.
- BYOK is required. There is no OpenLeash-managed evaluation or billing.
- It must reuse the same `client-api`, plugin model, schema, and migrations used by the open-source backend.
- It must not reintroduce SQLite, a desktop-only standalone mode, or a partial backend duplicated inside `desktop-client`.
- Mobile approval is optional and only works if mobile can reach the local backend through LAN, VPN, tunnel, or custom reachable URL.
- Cloud-run agents cannot reach a loopback local backend unless the user explicitly exposes it.

## 3. Org Admin - Public Cloud

Entry: marketing site or desktop client.

Flow:

1. Admin signs up with a work Google Workspace or Microsoft 365 / Entra ID account.
2. OpenLeash derives the organization workspace from the verified email domain.
3. Existing organization: admin signs into that dashboard workspace.
4. New organization: OpenLeash creates the workspace and starts dashboard onboarding.
5. Desktop shows: **You're setting up a team - continue onboarding in the dashboard**.
6. Dashboard onboarding configures identity, users/groups, roles, policy, model-provider settings, plugins, and deployment tokens.
7. Employees sign in through the identity provider and are provisioned automatically.
8. Admin distributes the desktop client.

Rules:

- Desktop is an org sign-up surface, not the full admin onboarding surface.
- Organization onboarding always hands off to the dashboard.
- Mobile is sign-in only for existing org users/admins.
- CISO/admin policies can be mandatory and cannot be disabled by employees.
- Organization BYOK is free up to 5 users, then $5/user/month.
- Organization Fully Managed is $12/user/month from the first user.

## 4. Org Admin - Private Cloud

Entry: customer-installed Private Cloud stack. There is no marketing-site sign-up.

Flow:

1. First launch of the Private Cloud dashboard starts bootstrap.
2. Admin creates the first admin user.
3. Admin names the organization.
4. Admin configures identity: Google Workspace, Okta, Ping, Microsoft Entra ID / Azure AD, LDAP / Active Directory-style sync, or local auth.
5. Admin configures policy, plugins, model-provider settings, and deployment tokens.
6. Employees sign in through the configured identity provider and are provisioned automatically.

Rules:

- UX mirrors public-cloud dashboard onboarding where possible.
- Same dashboard concepts, different backend.
- Desktop and mobile point at the customer-hosted `client-api`.
- Customer-hosted `dashboard-api` and `dashboard-web` are the admin/CISO surfaces.
- Private Cloud is one customer tenant unless the customer explicitly deploys multi-tenant private infrastructure.

## Surface Ownership

- `desktop-client`: tray app, local helper API, setup, hook installer, personal management, employee approval surface.
- `mobile-client`: approval companion and cloud/private sign-in surface.
- `main-web`: marketing, downloads, account entry, and public-cloud sign-up.
- `dashboard-web`: signed-in web product surface for personal/employee views plus org admin/CISO views.
- `client-api`: client-facing managed API for desktop and mobile.
- `dashboard-api`: admin/dashboard API.

## Guardrails

- If solo public-cloud setup opens org setup, identity sync, or CISO/admin views, the flow is wrong.
- If desktop setup offers local mode without the real `client-api` and Postgres, the flow is wrong.
- If Individual Open Source uses SQLite or a partial backend inside `desktop-client`, the flow is wrong.
- If employee setup asks the employee to choose CISO policies, the flow is wrong.
- If Private Cloud onboarding uses OpenLeash marketing-site sign-up, the flow is wrong.
