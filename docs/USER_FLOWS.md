# Leash User Flows

These are the canonical public onboarding and surface flows. Leash is a
personal product; public organization, dashboard, and identity-provider flows do
not exist.

## Shared requirements

- New user-facing copy says **Leash** and **Features**.
- Setup does not show organization, administrator, CISO, employee, directory,
  SSO, dashboard, marketplace, uploader, publisher, rating, or download-count
  choices.
- Built-in Features execute in the `client-api` process. Setup verifies the
  Feature registry and handler self-tests without starting Feature containers.
- Existing `/v1/plugins` paths and `openleash.*` IDs may be used internally for
  compatibility but are presented as Features.
- Questions and approvals appear on desktop, personal web, and enrolled mobile
  clients and play the configurable notification sound.

## 1. Personal Leash Cloud

Entry: desktop, mobile, or marketing website.

1. User chooses Leash Cloud.
2. Account creation completes in the same personal surface.
3. User chooses BYOK or Leash-managed evaluation when available.
4. Desktop setup selects agents and installs their hooks/proxy integration.
5. Leash verifies connectivity, the Feature registry, and enabled Feature
   handlers.
6. The Island begins showing live personal agent activity.
7. The user configures built-in Features from the personal settings surface.

There is no dashboard handoff or organization onboarding.

## 2. Personal Open Source

Entry: local installer, CLI, or desktop setup.

1. User chooses Personal Open Source.
2. Installer starts the real local `client-api` and Postgres.
3. User enters a supported LLM-provider key into the local backend.
4. User selects agents to monitor.
5. Setup installs hooks and configures the local proxy when needed.
6. Setup verifies the API, database, proxy path, built-in Feature registry, and
   deterministic Feature handler checks.
7. Desktop opens the personal management surface and Island.

Rules:

- No Leash Cloud sign-in, hosted evaluation, billing, dashboard, organization,
  identity provider, or marketplace is involved.
- Feature execution requires no Docker containers or runtime images.
- If Docker is used for the local API/Postgres packaging, setup describes that
  service requirement separately from Features.
- Mobile is optional and requires network reachability to the local backend.
- Cloud-run agents require a deliberately reachable local backend URL.

## Feature management

1. The user opens **Features**.
2. Leash lists only built-in, first-party Features shipped with the current
   release.
3. Each card shows purpose, status, compatible agents, settings, and recent
   outcomes—never publisher or popularity metadata.
4. The user enables/disables and configures a Feature.
5. The API validates settings against the manifest schema and saves personal
   base/profile settings.
6. The next matching event runs the registered handler in-process.

There is no browse/install/upload flow. “Available” means included in this
Leash release.

## Surface ownership

- `desktop-client`: setup, tray/Island, local helper API, hook/proxy management,
  personal Features, approvals, questions, and updates.
- `mobile-client`: personal approvals, questions, activity, and settings.
- `main-web`: marketing, downloads, and personal cloud account entry.
- `client-api`: personal hooks, evaluation, Feature execution, enrollment,
  synchronization, and updates.
- `docs-web`: public personal-product documentation.
- `flow-viewer`: developer-owned read-only local pipeline tracing.

No public surface owns organization administration, dashboards, or identity
providers.

## Guardrails

- If a public screen asks for an organization or identity provider, the flow is
  wrong.
- If a user can upload third-party runtime code, the flow is wrong.
- If Feature execution requires a container, marketplace installation, or image
  pull, the flow is wrong.
- If personal open source uses a duplicate desktop enforcement database instead
  of `client-api` and Postgres, the flow is wrong.
- If a question/approval cannot resolve the exact originating request, the flow
  is wrong.
