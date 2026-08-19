# Leash User Flows

These are the canonical public onboarding and surface flows. Leash offers
Personal and Business plans. The public repository owns the complete Personal
runtime and the public marketing/pricing entry point for Business; private
Leash Cloud owns Business administration, billing, tenancy, and identity.

## Shared requirements

- New user-facing copy says **Leash** and **Features**.
- Everyday screens call the main protection area **Safety** and explain each
  choice without assuming security or software knowledge. Technical names and
  raw scores are reserved for optional details and diagnostics.
- Configurable Features show a plain-English first layer with recommended
  choices. Exact scores, model overrides, timing, reuse, and policy controls sit
  in a discoverable **Advanced settings** section that is collapsed by default.
- Setup does not show organization, administrator, CISO, employee, directory,
  SSO, dashboard, marketplace, uploader, publisher, rating, or download-count
  choices.
- Built-in Features execute in the `client-api` process. Setup verifies the
  Feature registry and handler self-tests without starting Feature containers.
- Fresh setup enables every runtime-available built-in Feature. The Feature
  setup step is a read-only product showcase, not a protection picker.
- Existing `/v1/plugins` paths and `openleash.*` IDs may be used internally for
  compatibility but are presented as Features.
- Questions and approvals appear on desktop, personal web, and enrolled mobile
  clients and play the configurable notification sound.
- Public pricing presents Personal Free (BYOK), Personal Leash Cloud at $8 per
  month, and Business Leash Cloud at $18 per user per month or $14 per user per
  month with annual billing.
- Every Cloud offer includes Leash AI and a 10-day free trial. Cloud surfaces
  never show a provider-key input. Personal Open Source is the only BYOK mode.
- Once a client has reported in, Personal and Business overview screens lead
  with a rolling summary of actions monitored, threats blocked, actions that
  passed safely, actions approved by a person, and actions waiting for review.
  They also show which threat categories were involved and how many enrolled
  agents exist for each agent kind. Every count is backed by the same auditable
  evaluation history; Learning-only actions count as passed safely, never as
  blocked.
- Agent enablement and per-agent history live on a dedicated Agents page next
  to Overview. Connected devices use platform-specific artwork and show their
  last successful sync time rather than exposing raw hostnames as the primary
  identity.
- Desktop settings and the signed-in user's web dashboard are parallel
  per-user surfaces. Their Overview, agents, Features, approvals, history,
  notifications, and user settings should use the same client contracts and
  present the same information wherever the platform allows.
- A Business employee sees only their own Leash activity and settings on their
  computer. An administrator who opens Desktop still receives this same
  employee/user view. Organization administration is web-only and never
  appears because the local user has an administrator role.

## 1. Personal Leash Cloud

Entry: desktop, mobile, or marketing website.

1. User chooses Leash Cloud.
2. Account creation completes in the same personal surface.
3. Leash starts the 10-day trial and confirms that Leash AI is included.
4. Desktop setup selects agents and installs their hooks/proxy integration.
5. User sees a real Island preview and explicitly chooses whether to enable it;
   the tray remains installed either way.
6. Leash shows every built-in Feature as on automatically, then verifies
   connectivity, the Feature registry, and enabled Feature handlers.
7. If enabled, the Island begins showing live personal agent activity.
8. The user configures built-in Features from the personal settings surface.

When account creation starts on the marketing website:

- The personal web surface never claims that agents are protected before a
  desktop computer has connected.
- After package selection, the web surface presents the current Mac and Windows
  installers and explains that Desktop detects agents and finishes setup.
- The web surface waits for the first desktop connection and opens the overview
  automatically after the computer reports in.
- Until that connection exists, the full agent and Feature dashboard stays out
  of view. The user sees a short, accurate setup checklist instead.
- Optional mobile approvals may be introduced as a coming-soon or enrollment
  step, but they never block desktop protection.

There is no dashboard handoff or organization onboarding.

## 2. Personal Open Source

Entry: local installer, CLI, or desktop setup.

1. User chooses Personal Open Source.
2. Installer starts the real local `client-api` and Postgres.
3. User enters a supported LLM-provider key into the local backend.
4. User selects agents to monitor.
5. Setup installs hooks and configures the local proxy when needed.
6. User sees a real Island preview and explicitly chooses whether to enable it;
   the tray remains installed either way.
7. Setup shows every built-in Feature as on automatically, then verifies the
   API, database, proxy path, Feature registry, and deterministic handler checks.
8. Desktop opens the personal management surface and, when selected, the Island.

Rules:

- No Leash Cloud sign-in, hosted evaluation, billing, dashboard, organization,
  identity provider, or marketplace is involved.
- Feature execution requires no Docker containers or runtime images.
- If Docker is used for the local API/Postgres packaging, setup describes that
  service requirement separately from Features.
- Mobile is optional and requires network reachability to the local backend.
- Cloud-run agents require a deliberately reachable local backend URL.

## 3. Business Leash Cloud

Entry: public marketing website.

1. The visitor selects **Business** in the Personal/Business switcher.
2. The public site shows a 10-day trial for up to 2 employees, followed by $18
   per user per month or $14 per user per month with annual billing.
3. The visitor chooses the Business call to action.
4. The public flow hands off to private Leash Cloud signup or sales onboarding.
5. Leash AI and the CISO-style dashboard are included; no provider-key choice
   is shown.
6. Private Leash Cloud owns organization setup, tenancy, billing, identity,
   mandatory policy, and support operations.
7. Installed clients continue using the public client contract against the
   hosted API; private control-plane code is never imported into the public core.
8. A CISO or organization administrator can enable **Learning only**. Leash
   continues evaluating and recording every action for the Business dashboard
   and audit pipeline, but clients never block or wait for approval.
9. The CISO or administrator can independently disable employee notifications.
   Security-team visibility and audit exports continue; enrolled mobile and
   desktop clients suppress employee-facing approval alerts.
10. During onboarding, after identity setup, the administrator may optionally
    connect one or more read-only provider analytics keys. This step is
    skippable and does not prevent organization activation.
11. Until a source is connected, **Costs & usage** shows its full navigation and
    empty dashboard structure with a setup prompt. After sync, the executive
    view shows budget, spend trend, projects, employees, agents, and models;
    each employee can be expanded to see attributed projects and agent mix.
12. Cursor, Claude Code, Claude Enterprise, Anthropic API, OpenAI Platform, and
    ChatGPT/Codex are separate source types because their official APIs use
    different credentials and report different dimensions. Connecting an
    analytics key never changes the runtime evaluation provider.
13. Every enrolled employee, including an administrator, gets the same
    per-user Desktop surface as Personal Cloud: their own overview, agents,
    Features, approvals, history, notifications, and permitted user settings.
    Organization rosters, aggregate activity and spend, identity sync,
    organization policy, admin API keys, billing, and audit administration are
    available only in the private web dashboard.

Private Business onboarding should use the same connection model in Business
language: create the workspace, connect one pilot computer through Leash
Desktop, choose agents, then apply policies and roll out to the team. Agent
status and history must not appear populated before a client reports in.

## Feature management

1. The user opens **Features**.
2. Leash lists only built-in, first-party Features shipped with the current
   release.
3. Each card shows purpose, status, compatible agents, settings, and recent
   outcomes—never publisher or popularity metadata.
4. The user enables/disables and configures a Feature. Everyday choices appear
   first; exact technical controls remain available under **Advanced settings**.
5. The API validates settings against the manifest schema and saves personal
   base/profile settings.
6. The next matching event runs the registered handler in-process.

There is no browse/install/upload flow. “Available” means included in this
Leash release.

## Surface ownership

- `desktop-client`: setup, always-on tray, optional Island, local helper API,
  hook/proxy management, and the signed-in person's Overview, agents, Features,
  approvals, questions, history, notifications, permitted settings, and
  updates. Business membership changes effective policy, not the scope of the
  local interface; Desktop never becomes an organization-admin console.
- `mobile-client`: personal approvals, questions, activity, and settings.
- `main-web`: marketing, downloads, Personal Cloud entry, Business pricing, and
  the private-cloud Business handoff.
- `client-api`: personal hooks, evaluation, Feature execution, enrollment,
  synchronization, and updates.
- `docs-web`: public personal-product documentation.
- `flow-viewer`: developer-owned read-only local pipeline tracing.

No public surface owns organization administration, dashboards, billing
implementation, or identity providers. Showing Business pricing and a hosted
handoff is allowed.

SIEM reporting is organization-only private infrastructure. It does not appear
in personal setup, personal settings, or the personal Feature list.

## Guardrails

- If public repository code implements organization administration, billing, or
  identity-provider setup instead of handing off to private Cloud, the flow is
  wrong.
- If a user can upload third-party runtime code, the flow is wrong.
- If Feature execution requires a container, marketplace installation, or image
  pull, the flow is wrong.
- If personal open source uses a duplicate desktop enforcement database instead
  of `client-api` and Postgres, the flow is wrong.
- If an organization role exposes employee rosters, aggregate organization
  analytics, identity sync, billing, provider admin keys, or organization
  policy editing in Desktop, the flow is wrong.
- If a question/approval cannot resolve the exact originating request, the flow
  is wrong.
