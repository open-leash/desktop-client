# Leash Product Contract

This is the source of truth for the public product, runtime, naming, Features,
and release expectations. If another document or screen disagrees, fix it.

## Product and audience

Leash protects AI-agent activity for individuals and businesses across desktop,
web, and optional mobile surfaces. The public open-source runtime remains a
complete personal product, while the public marketing site presents both
Personal and Business Leash Cloud offers.

The public repository does not expose an organization dashboard, dashboard API,
identity-provider integrations, employee provisioning, centralized CISO policy,
or multi-tenant administration. Leash may operate private cloud systems for
hosted accounts, billing, operations, and Business Cloud administration, but
those systems are not part of this repository or its public API surface.

The desktop settings surface and the signed-in user's web dashboard are two
clients of the same per-user product. They should converge on the same personal
overview, agent status, Features, approvals, history, notifications, and
user-editable settings. A Business employee sees their own Leash activity in
Desktop exactly as a Personal user does, with organization policy applied by
the hosted API. An organization administrator also sees only their own user
surface in Desktop; having an administrator role never unlocks local
organization controls. Organization-wide people, policy, identity, billing,
cost-source, audit-export, and CISO/CIO views are available only in the private
web dashboard.

## Product offers

### Personal, Free (BYOK)

- Runs `desktop-client`, the real open-source `client-api`, and Postgres for one
  user.
- Has no Leash Cloud sign-in, hosted account, billing, dashboard, organization,
  or identity-provider setup.
- Uses a user-supplied LLM-provider key for evaluations.
- Stores personal settings, Feature state, approvals, outcomes, and history in
  local Postgres.
- Uses the same client API, schema, migrations, event pipeline, and Feature
  handlers as the public core used by hosted personal clients.
- Must not use SQLite or a desktop-only duplicate backend for enforcement.

Docker may package Postgres and the local API, but it is not part of Feature
execution. A Feature never needs a container runtime.

Price: **Free**.

### Personal, Leash Cloud

- Desktop, web, and mobile use the Leash-hosted personal `client-api` surface.
- Leash AI is included; Cloud never asks for or accepts a customer model-provider key.
- A 10-day free trial starts at first Cloud sign-in with no card required.
- Cloud keeps protection, approvals, history, and settings available across devices.
- The connected Personal overview leads with a rolling activity summary: actions
  checked, attacks or sensitive actions blocked, automatic approvals, manual
  approvals, pending decisions, the leading threat categories, and enrolled
  agent counts grouped by kind.
- Hosted tenancy, billing, abuse controls, production credentials, signing,
  support, and operations live in private Leash Cloud code.
- Public code exposes provider interfaces and personal client contracts; it does
  not expose private administrative services.

Price: **$8 per month**.

### Business, Leash Cloud

- The public marketing site may present Business pricing and a hosted signup or
  sales entry point.
- Business clients use Leash Cloud; organization administration, tenancy,
  billing, identity, mandatory policy, support, and operations remain private
  Leash Cloud systems.
- Leash AI and the CISO-style Business dashboard are included.
- The Business dashboard leads with the same rolling outcome, threat-category,
  and agent-kind summary across the organization so security leaders can see
  what Leash stopped and what it allowed without opening individual events.
- Private Business settings provide two independent organization controls:
  **Learning only** keeps evaluation, proxying, audit history, and security-team
  visibility active while allowing actions that otherwise would be blocked or
  held for approval; **Employee notifications** may be disabled without
  suppressing dashboard activity or audit exports.
- Private Business cost intelligence groups organization AI spend by provider,
  agent, model, employee, and project. Provider-native project IDs are
  authoritative; when a provider supplies user-level cost but no project,
  Leash may label the row from same-day enrolled-agent activity and clearly
  marks that label as inferred.
- Cost sources are optional, read-only administration/analytics credentials,
  separate from Leash AI evaluation credentials. A Business organization may
  connect multiple Cursor teams, Claude Platform or Claude Enterprise
  organizations, OpenAI Platform organizations, and ChatGPT/Codex workspaces.
  The empty cost dashboard remains visible before setup and directs an
  administrator to the skippable connection step.
- A 10-day free trial covers up to 2 employees; adding more employees requires
  a paid subscription.
- Public clients and the public core do not import or expose the private
  Business control plane.
- Business Desktop remains a per-user client. It may explain that a setting is
  managed by the organization, but it never exposes employee rosters,
  organization analytics, provider administration keys, directory sync,
  billing, organization policy editing, or other administrator actions. Even
  an organization administrator uses the private web dashboard for those
  actions.
- Built-in Features still execute through the typed `client-api` registry. A
  Business plan does not create a third-party Feature or arbitrary-code path.

Price: **$18 per user per month**, or **$14 per user per month when billed
annually**.

## Public repository boundary

The public core contains the desktop and mobile clients, personal `client-api`,
local proxy, provider puller, flow viewer, docs, Personal and Business offer
marketing/pricing, shared contracts, Postgres schema/migrations, and built-in
Features.

It does not contain or publish dashboard applications, dashboard APIs,
identity/directory providers, Business administration/onboarding implementation,
or a Feature marketplace. Public Business calls to action hand off to private
Leash Cloud systems.

SIEM reporting is not a Feature and is never available in either personal
mode. Organization products compose a private audit-export provider through the
public core's typed event contract. That organization service owns endpoint and
credential configuration, delivery attempts, retries, and operational status;
the personal Feature catalog and Feature runtime never execute SIEM delivery.

## Naming and compatibility

The user-facing product name is **Leash**. New interface copy, documentation,
release notes, and diagnostics use Leash.

Stable technical identifiers may retain the old namespace where changing them
would break existing installs. This includes `@openleash/*` package scopes,
`OPENLEASH_*` environment variables, application bundle identifiers, API hosts,
database names/columns, and Feature IDs such as `openleash.dlp`.

Likewise, `/v1/plugins` and plugin-shaped manifest fields remain versioned
compatibility contracts for existing clients. Product surfaces call them
Features. Compatibility terminology must not leak into new user-facing copy.

## Built-in Feature contract

A Feature is a first-party capability shipped with Leash.

- Only the Leash team authors and distributes Features.
- There is no upload flow, external uploader/publisher identity, community
  listing, download counter, rating, or marketplace installation.
- Fresh setup enables every runtime-available built-in Feature. The setup page
  showcases what each Feature does; it is not an installation picker. After
  setup, Features may be enabled, disabled, and configured by the user.
- `client-api` executes Feature handlers in-process in Node.js. It does not
  launch containers, pull images, call a local runtime gateway, or load arbitrary
  third-party code.
- A typed registry binds each stable manifest to its handler. Unknown IDs are
  rejected rather than dynamically imported.
- The runtime preserves event subscriptions, execution ordering, capability
  permissions, request-scoped settings, outcomes, logs, and failure behavior.
- Installation verifies the API’s Feature registry and a deterministic handler
  self-test; it does not verify Docker images or container health.
- Feature authors add a manifest, handler, focused unit tests, and registry entry
  in `apps/client-api/src/features` (the existing internal `plugins` directory
  may remain temporarily as a source-compatible path).

Feature settings in the public core are evaluated per user. Manifest defaults
are followed by base settings and matching user profiles. Profiles may target
project roots, agent kinds, or stable enrolled runtime IDs. Mandatory Business
policy, when offered, is a private Leash Cloud overlay and is not implemented by
the public product.

Rules discovered from `CLAUDE.md`, `AGENTS.md`, and other agent instruction
files are suggestions. The user explicitly selects which discovered rules
Rules Protection should enforce.

The canonical customer-facing Feature names are **Destructive Protection**,
**Code Protection**, **Private Data Protection**, **Password Protection**,
**Prompt Injection Protection**, **Connected Apps Protection**, **Rules
Protection**, and **Token Saver**. Public copy uses
these names consistently. Stable slugs and IDs remain implementation details
for compatibility and are not used as marketing names.

Normal product screens use outcome language that a first-time AI user can
understand. They explain what AI tried to do, what could happen, and what Leash
did. Internal terms such as prompt injection, MCP, exfiltration, risk threshold,
SSRF, CSRF, token compression, policy evaluation, and stable Feature IDs belong
only in optional technical details, diagnostics, logs, or developer docs. Raw
engine scores are not normal settings: present them as plain choices such as
**Warn me more**, **Balanced**, and **Only strong warnings** while preserving
their numeric values in the API contract.

Every configurable Feature uses progressive disclosure. The first layer shows
plain recommended choices and describes their real-world effect. A clearly
labeled, collapsed **Advanced settings** section may expose exact scores, model
overrides, timing and reuse values, policy sets, and other controls needed by a
technical operator. Advanced settings remain discoverable, but opening them does
not replace the plain explanation, recommended default, or description of what
changing the value will do.

## Agent event pipeline

Every transport enters `client-api` as the same normalized, versioned event.
The event records source, provider, idempotency key, correlation ID, and explicit
enforcement capabilities.

- `api_hook` can observe and block and may rewrite supported tool input.
- `local_proxy` can observe and transform prompts before forwarding. It holds
  tool-capable responses until complete tool calls are reconstructed and
  evaluated.
- `provider_puller` is retrospective observation and cannot mutate an action
  that already completed.

Hooks and proxy events describing the same action are deduplicated before
Feature execution. Feature handlers use declared event capabilities rather than
guessing from the agent name.

The public client API accepts a typed runtime-policy provider from a private
Business deployment. The public core does not store or administer organization
policy. When the provider returns learning mode, the original evaluation and
Feature outcomes remain durable while the effective agent response is `allow`;
an `ask` outcome is marked resolved by the organization mode so no request is
left waiting. Notification delivery consults the same provider independently.

The cross-platform Rust `local-proxy` is separate from Feature execution. It
submits normalized requests to `client-api`, which runs enabled Features in
process, persists outcomes, and returns the decision. It never invokes a Feature
directly. The desktop package bundles and runs the native proxy executable;
Personal and Business Cloud customers do not need Docker. Personal Open Source
may still use Docker to package Postgres and its local `client-api`.

A user may pause monitoring for one exact conversation for at most 30 minutes.
The pause stays visible and resumable and never becomes a global fail-open mode.

## Attention and response routing

The canonical attention types are `approval`, `question`, `plan_review`,
`blocked`, `completed`, and `subagent_completed`. They are durable backend
records. Desktop, personal web, and mobile subscribe to per-user invalidations;
polling is only a recovery path.

Approvals, answers, and plan feedback resolve the exact request that originated
them. The backend must not broadcast an executable response to unrelated
devices or conversations.

Native background mobile push requires a real APNs/FCM/Expo device token.
Foreground live updates may use local notifications before production push
credentials are connected.

## Hook direction

Installed hooks call the configured `client-api` directly:

```text
https://api.openleash.com/v1/hooks/:agent/:event
```

Personal Open Source normally uses `http://127.0.0.1:9318`. If that backend is
unavailable, protected hooks fail closed with a clear diagnostic. Cloud-run
agents cannot reach loopback unless the user provides a tunnel, VPN, LAN route,
or another reachable URL.

## Updates and releases

- Desktop releases publish macOS and Windows artifacts, checksums, release
  notes, and an update-feed entry. Production signing/notarization is applied
  when the platform credentials are configured; unsigned development builds
  are labeled accordingly.
- Mobile, web, and API releases are tested against the same personal API
  contract.
- Personal Open Source backend releases publish versioned service artifacts and
  safe Postgres migrations.
- Release gates cover Feature registry integrity, handler unit tests, API/hook/
  proxy integration, desktop setup, mobile/web attention flows, updates, clean
  installation, and upgrade compatibility.
- Feature tests run without Docker. Docker-dependent tests are limited to
  service packaging, Postgres, or proxy packaging where applicable.
