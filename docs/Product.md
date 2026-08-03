# OpenLeash Product Contract

This is the product source of truth for modes, package semantics, BYOK behavior, hook direction, and release expectations. If another doc or screen disagrees with this file, fix the other doc or screen.

## Product Modes

OpenLeash desktop requires a backend. There is no supported standalone desktop-only mode.

### Individual Open Source mode

For one technical user who wants OpenLeash locally without OpenLeash Cloud runtime.

- Runs `desktop-client`, the real open-source `client-api`, and Postgres locally, usually through Docker.
- Uses the same Postgres schema, migrations, plugin model, and evaluation pipeline as other modes.
- Has no OpenLeash Cloud sign-in, hosted account, billing, or OpenLeash-managed evaluation.
- Requires the user to provide their own LLM provider key.
- Stores account state, policy, plugin settings, approvals, outcomes, and audit history in local Postgres.
- May read the public OpenLeash plugin catalog and desktop update feed.
- Installs/enables/configures plugins only through the local `client-api`.
- Must not use SQLite, a desktop-only backend, or a partial duplicate backend.

### Private Cloud

For an organization running OpenLeash on-prem or in its own cloud.

- Runs `desktop-client`, optional `mobile-client`, `client-api`, `dashboard-api`, `dashboard-web`, and Postgres.
- Clients talk to the customer-hosted `client-api`.
- Admins use the customer-hosted dashboard.
- The customer owns identity, users, policy, audit, model-provider settings, approvals, deployment tokens, and upgrades.
- The public core must support Google Workspace, Okta, Ping, Microsoft Entra ID / Azure AD, and LDAP / Active Directory-style sync.
- Must remain fully open source and runnable without OpenLeash-operated SaaS.

### OpenLeash Cloud

For the OpenLeash-operated hosted service.

- Desktop installations run the local `client-api` edge surface for proxy traffic and container-plugin execution. This edge surface is not a standalone backend: it owns no cloud account, policy, billing, or audit source of truth and relays normalized enforcement to OpenLeash-hosted endpoints such as `api.openleash.com`.
- Hooks and SaaS/provider events that do not originate on a desktop call the OpenLeash-hosted `client-api` directly.
- Solo users use OpenLeash Cloud without org-admin dashboard onboarding.
- Organization admins are handed off to the hosted dashboard after account creation.
- Hosted-only tenancy, billing, abuse controls, production credentials, signing, ops, and cloud admin tooling belong outside the public repo.

## Pricing Packages

- Individual BYOK: free. User supplies their own LLM key; OpenLeash Cloud stores it encrypted and invokes evaluation against that provider.
- Individual Fully Managed: $8/month. OpenLeash Cloud supplies evaluation.
- Organization BYOK: free up to 5 users, then $5 per user per month after that. The organization supplies its own LLM key; OpenLeash Cloud manages users, policy, approvals, audit, and evaluation calls.
- Organization Fully Managed: $12/user/month from the first user. OpenLeash Cloud supplies evaluation.
- Individual Open Source: free local open-source install. User supplies their own LLM key; OpenLeash Cloud is not part of enforcement runtime.

## API Shape

`client-api` is one published service for all modes. Do not split it into `individual-client-api` and `org-client-api`.

- Individual Open Source enables the single-user core runtime.
- Private Cloud enables organization and dashboard capabilities.
- OpenLeash Cloud composes hosted SaaS adapters around the same public core.
- The desktop edge surface implements the same versioned proxy/plugin contracts and may be embedded in the desktop process or shipped from the same `client-api` artifact. It must remain a thin execution/relay profile rather than a second backend.
- The implementation boundary is `apps/client-api/src/product-mode.ts`.

Public cloud wrappers should stay thin:

- `cloud-client-api` wraps public `client-api`.
- `cloud-dashboard-api` wraps public `dashboard-api`.
- `cloud-dashboard-web` wraps public `dashboard-web`.

## Development Observability

`apps/flow-viewer` is the public, read-only local observability app for
normalized agent-event pipeline traces. It may display hook, local-proxy, and
provider-puller stages from a developer-owned NDJSON trace, but it is not a
backend, policy authority, approval surface, or supported production ingress.
It binds to loopback by default and never uploads trace data.

## Agent Event Pipeline

Every transport enters `client-api` as the same versioned normalized event. The event records its source, provider, idempotency key, correlation id, and explicit enforcement capabilities.

- `api_hook`: observes and blocks; may rewrite tool input when the agent protocol supports it, but cannot rewrite a prompt already submitted.
- `local_proxy`: observes and can block or rewrite prompts before forwarding. Provider responses from tool-capable requests are held until fragmented tool calls are reconstructed and synchronously approved; denied or unevaluated tool-call bytes are never released. Text-only responses retain bounded asynchronous telemetry. Tool-input rewriting and response rewriting are not advertised.
- `provider_puller`: retrospective observation only. It cannot block or mutate the already completed provider action.

Events from hooks and the proxy may describe the same action. `client-api` deduplicates them by authenticated user and a transport-independent event fingerprint before plugin execution. Plugins must use the event capabilities, never an agent-name guess, when deciding whether a requested effect is available. Unsupported active effects are recorded as observation-only outcomes.

The open-source `local-proxy` is a separate cross-platform Rust service, normally installed as a container by desktop/CLI after Docker validation. It supports upstream corporate proxy chaining, preserves streaming responses, has an explicit health endpoint, and fails closed when protected evaluation is unavailable unless an operator deliberately enables fail-open behavior.

SaaS connector pulling is a retry-safe worker concern. Provider connectors checkpoint their cursors, normalize fetched conversations/events through the same ingestion API, and label findings as retrospective.

Individual accounts may temporarily pause monitoring for one exact agent conversation from the Island. A pause is user-scoped, expires within 30 minutes, remains visible with an explicit resume action, and bypasses request transforms, evaluation, response telemetry, and tool-call gating only for the selected agent/session identifiers. It must never become an agent-wide or persistent fail-open switch. Organization-managed accounts cannot create this bypass from a client surface.

### Client attention and response routing

The canonical user-attention types are `approval`, `question`, `plan_review`,
`blocked`, `completed`, and `subagent_completed`. They are durable backend
records, not desktop-only UI state. Personal desktop, web, and mobile surfaces
subscribe to authenticated per-user invalidations and refresh the same records;
polling is only a recovery path.

Approvals, question answers, and plan feedback resolve the evaluation held by
the request that originated it. A desktop hook or proxy resumes on that same
desktop request. A cloud or SaaS agent resumes through its own server-side
request. The backend must not broadcast an executable response to unrelated
desktops or to other users in the organization.

Native background mobile push depends on a real store-build APNs/FCM/Expo
device token. Before production push credentials are connected, foreground
mobile sessions still receive the live stream and create local notifications;
documentation and UI must not imply that a terminated app can receive push
without a provider token.

## Hook Direction

Installed agent hooks call the configured `client-api` directly:

```text
https://api.openleash.com/v1/hooks/:agent/:event
```

Private Cloud uses the customer-hosted `client-api` URL. Individual Open Source uses the local `client-api` URL, usually `http://127.0.0.1:9318`.

The desktop local API may exist for setup, tray state, OAuth callbacks, local cache, and legacy/dev relay behavior, but it is not the canonical installed hook target. If the configured backend is unavailable, protected hooks fail closed with a clear backend-unavailable message.

## BYOK Clarifications

Public cloud BYOK clarification: for individual and organization cloud packages, the user or organization enters their own LLM provider key into OpenLeash Cloud. OpenLeash stores it encrypted and invokes evaluation from OpenLeash Cloud against the selected provider.

Individual Open Source BYOK clarification: the user enters their own LLM provider key into their locally running `client-api`. OpenLeash Cloud never stores the key and never invokes evaluation.

## Update Contract

- Desktop app updates use the OpenLeash public update feed by default in every mode.
- Private Cloud may override this with manual or private update distribution.
- Individual Open Source backend updates use Docker image pulls plus Postgres migrations.
- Private Cloud backend updates use the same migration discipline with backups and rollback planning.

## Plugin And Policy Contract

- Plugin functionality is rendered from backend-owned plugin manifests, category metadata, settings schemas, and outcome records.
- Do not create separate hardcoded first-party pages for plugin features such as DLP or compression.
- Organization policy may make plugins mandatory, lock settings, or provide defaults.
- Organization controls are independent: `mandatory` controls removal, `defaultEnabled` controls the initial state, `userInstallAllowed` controls optional catalog additions, and `configLocked` controls employee overrides. Making a plugin mandatory must not silently lock its settings or close the catalog; an admin chooses each restriction explicitly.
- The effective plugin state for a request is resolved in this order: manifest defaults, organization base settings, matching organization profiles, user base settings when permitted, then matching user profiles. Profiles are ordered by priority and may match a normalized project root, an agent kind, an exact authenticated/enrolled runtime ID, or a combination of those dimensions. Project roots match work in their descendant folders. Caller-supplied agent IDs are never accepted as authorization scope.
- Mandatory plugins cannot be disabled by a user's base setting or user profile. Organization profiles may still narrow or alter a mandatory plugin per agent because they represent admin policy. When settings are unlocked, employees may keep personal configuration and per-agent profiles even for a mandatory plugin.
- Individual Open Source and individual OpenLeash Cloud accounts have full user control and no organization-management banner. OpenLeash Cloud organization accounts and all Private Cloud accounts expose the independent admin controls above; employee freedom is exactly what the organization policy allows.
- Individual Open Source may browse the public plugin catalog, but local install state and execution remain local.
- Rules imported from agent instruction files are discovery inputs only. Enforcement uses saved `rules-enforcer` plugin settings.
- Plugin manifests declare `executionEnvironment: "cloud-only"` for workloads that may run only in OpenLeash Cloud. The public plugin runtime refuses to execute those plugins in Individual Open Source and Private Cloud; UI and APIs must expose the restriction instead of silently attempting a local fallback.
- Every plugin runs out of process through the versioned, language-independent `openleash-container-plugin.v1` protocol. There is no trusted in-process plugin type or execution fallback. Manifests declare immutable image identity, subscribed events, placement (`edge`, `server`, or `either`), permissions, resources, storage, timeout, and failure behavior.
- `client-api` and the desktop edge are plugin orchestrators only. Product-specific detection, transformation, and policy logic belongs in plugin images; the host exposes only narrow, permission-checked capabilities over the container protocol. Desktop plugins without `network:access` run on an internal Docker network with no default route; a loopback-only allow-list gateway carries signed protocol traffic to installed plugin IDs without becoming a general outbound proxy.
- `local-proxy` never calls a plugin directly. It submits the provider request to the local `client-api` edge surface, which orders plugins, signs container calls, validates correlated responses and constrained JSON patches, then returns the final provider request.
- Desktop reconciles enabled account plugins into one constrained container per plugin per computer. Containers without reviewed `network:access` run on the internal plugin network and are reached only through the loopback allow-list gateway. Disabling or uninstalling a plugin removes its managed container while retaining or deleting plugin storage according to the explicit uninstall choice.
- Plugin state has two explicit tiers. Every edge container receives a plugin-derived persistent `/data` volume by default for private implementation state and caches; a manifest may opt out. That volume is isolated from other plugins, is never an OpenLeash database mount, and is local to that execution installation. Plugins may use SQLite or bundle a private PostgreSQL server whose entire data directory lives under `/data`. Bundled PostgreSQL is permitted only for single-replica user-dedicated, tenant-dedicated, customer-hosted, or local single-user execution; it is never used by a shared worker.
- History-aware plugins use the normalized event transcript first and may declare `conversation:read` to request a bounded recent window for the authenticated current session through `capabilities.context.conversation.recent()`. Conversation context—not a plugin's private database—is the default source for decisions that must behave consistently across local and cloud agents.
- `capabilities.storage` remains an optional, permission-checked document API for small plugin-owned values such as deduplication keys or derived preferences. It is not a generic database interface and must not be presented as the default place for conversation history. Plugins never receive OpenLeash database credentials or arbitrary SQL access.
- Local plugin volumes and database files are never replicated between a laptop and cloud workers. SQLite, PostgreSQL, MongoDB, files, indexes, and other data under `/data` are private to that runtime. Local and cloud copies may differ, and plugin documentation must say so plainly. Individual Open Source remains local by design.
- Conversation access is host mediated. The current normalized event may include a transcript, while plugins that declare `conversation:read` may request a bounded recent window for only the authenticated current session. Plugins cannot choose another organization, user, or arbitrary session.
- Plugin configuration is request scoped. Organization defaults are merged with zero or more ordered organization/user profiles that may target a project root, an agent kind and, where a stable enrolled runtime ID is available, one or more exact agent instances. Project paths are matching context, not an authorization boundary. Product surfaces should offer paths already observed from enrolled agents while also allowing an administrator or user to enter a project root manually. The resolved profile IDs, configuration hash, and resolved configuration travel in every signed runtime request. Settings are never injected as per-profile environment variables, and profile creation never creates another container.
- Desktop runs one container per installed plugin version per signed-in account and computer, not one container per agent or settings profile. Its `/data` volume is account-scoped so signing into another account never reuses the previous account's private plugin files. OpenLeash Cloud shares warm workers only for explicitly reviewed `shared-trusted` plugins; tenant identity and settings remain request scoped. A plugin may cache compiled/model state by configuration hash but must not retain tenant configuration as global mutable state.
- OpenLeash Cloud runs trusted first-party container plugins as warm, horizontally scaled pools per plugin version. The hosted `client-api` routes through a separate runtime service or internal service endpoint; it must never receive a Docker socket.
- Community and private plugins are never promoted into a shared cloud worker merely because their image implements the protocol. A plugin that owns an embedded database, receives direct database credentials, keeps mutable user state outside host capabilities, or has not completed the shared-runtime security review uses `user-dedicated`, `tenant-dedicated`, or `customer-hosted` isolation.
- A `user-dedicated` cloud runtime is provisioned from an immutable image when the user installs/enables the plugin, not built or created on the first protected event. The runtime controller creates its identity, route, secret and persistent volume immediately, then starts the pod. A desktop login/presence signal prewarms every enabled user-dedicated plugin before agent traffic. The normal event path only routes to a ready pod; if that pod is unexpectedly absent, the runtime queues the event for a bounded wake-up attempt and otherwise fails according to the manifest rather than silently bypassing protection.
- A user-dedicated pod may be stopped after the user has no connected desktop and no plugin traffic for an operator-defined idle period. Stopping or replacing the pod never deletes its volume. The next desktop presence signal starts it again. Users or operators may choose always-warm operation when latency matters more than compute cost.
- A bundled PostgreSQL plugin runs its application and private database inside the same user-dedicated pod/container appliance, listens only on loopback, stores `PGDATA` under `/data`, uses one replica and a single-writer volume, and handles graceful shutdown before the volume detaches. The runtime never exposes that database port or mounts the volume into another user's workload. Managed external PostgreSQL remains an optional higher-availability deployment, not a requirement.
- A persistent volume does not make two independent databases safely synchronizable. Local agent events execute locally and cloud-agent events execute in the cloud; OpenLeash does not reroute one through the other to preserve a plugin database. Plugins that subscribe in both locations should base history-aware decisions on normalized conversation context. Their private `/data` databases remain runtime-local implementation details.
- Execution ownership is per plugin event: correlated edge-completion evidence is recorded and prevents a second cloud execution; absent edge evidence—such as for SaaS agents, provider-hosted runtimes, or an event not subscribed at the edge—the hosted `client-api` invokes the corresponding cloud worker.
- Shared cloud workers are stateless with respect to tenant data. Durable state uses organization + plugin + user/session scoped capabilities. Custom or high-isolation plugins use user-dedicated, tenant-dedicated, or customer-hosted placement.
- Community container releases require an approved manifest and an immutable image digest. Runtime endpoints and credentials are operator configuration and never marketplace data.

## Security Scope

Client APIs derive user, organization, computer, and agent scope from the authenticated token/session. They must not trust caller-supplied scope when authenticated scope is available.

Dashboard/CISO routes may expose organization-wide data only after dashboard-session authentication and role authorization.

## Release Expectations

- `client-api`: publish versioned Docker images and release notes for Individual Open Source and Private Cloud; run migrations safely against user/customer Postgres.
- `dashboard-api` and `dashboard-web`: publish versioned artifacts for Private Cloud and public-cloud wrappers.
- `desktop-client`: bump version, test API compatibility, publish checksum-verified desktop artifacts, and update public download links. During the current development distribution phase, signing and notarization credentials are intentionally not required: releases remain unsigned, say so explicitly in their notes, and rely on immutable GitHub assets plus published SHA-256 checksums. Re-enable mandatory platform signing only when the required production credentials are actually provisioned.
- `mobile-client`: bump app/build versions, sign release builds, and publish through the app stores.
- Cloud wrappers: release through OpenLeash-operated cloud pipelines with API versioning and backward compatibility for older clients.
