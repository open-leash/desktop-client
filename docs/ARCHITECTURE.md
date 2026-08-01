# OpenLeash Architecture

```text
Local agent --native hooks----------------------+
      |                                         |
      +--LLM protocol--> local-proxy --> desktop client-api edge --> plugin containers --> provider
                                                v
                                   normalized agent event
                                                |
                                                v
                                  client-api + plugin processor
                                                |
                                                v
                                             Postgres

External agents: Azure AI Foundry, Copilot Studio, Agentforce,
Bedrock AgentCore, Vertex AI, n8n, Zapier
        |
        | connector sync: agents, threads, transcripts, traces
        v
provider puller --> normalized agent event --> client-api
```

The canonical ingestion contract is `POST /v1/agent-events`. Hook adapters continue to expose native `/v1/hooks/:agent/:event` responses, but attach `api_hook` semantics. Proxy events use `local_proxy`; connector workers use `provider_puller`. Capability metadata controls whether plugins may observe, block, or rewrite, and an idempotency key prevents hook/proxy double processing.

The Rust proxy follows the transport invariants proven in the in-repo Headroom reference implementation: hop-by-hop and connection-listed headers are stripped, internal OpenLeash headers never leak upstream, non-intercepted request bodies stream without buffering, text-only provider responses use bounded telemetry capture, tool-capable HTTP/SSE responses are bounded and held for synchronous `PreToolUse` evaluation, WebSocket sessions are pumped bidirectionally, redirects are passed through, and long model streams use a separate connect/total timeout policy. Before provider delivery it submits structured JSON to the authenticated desktop `client-api` edge; that edge—not the proxy—orders and invokes container plugins. Denied or unevaluated tool-call bytes are never delivered; unrelated requests remain concurrent.

## Two Monitoring Modes

OpenLeash has two distinct monitoring modes. They share the same policy engine, database model, dashboard, mobile approvals, and audit history, but they differ in timing and enforcement power.

### Real-Time Interception

Real-time interception is the primary OpenLeash control path for local and hook-capable agents. The agent invokes an OpenLeash hook before or after meaningful actions, such as prompt submission, tool use, command execution, file access, or session stop. OpenLeash receives the event before the agent proceeds, evaluates policy, and can return `allow`, `ask`, or `deny`.

This mode is used for desktop agents with implemented hook adapters: Claude Code, OpenAI Codex, GitHub Copilot, Cursor, Gemini CLI, OpenCode, OpenClaw, and NanoClaw. Future agents can join this path when they expose hooks, callbacks, middleware, policy webhooks, or tool-interception APIs.

Expected behavior:

- The installed desktop client discovers supported local agents and installs user-level hook configuration.
- Hooks call the configured managed `client-api` endpoint with normalized agent context.
- The active API records the event, evaluates policies, and creates an approval when human input is needed.
- Desktop and mobile apps show the same pending approval.
- When the user approves or denies, the API records the resolution.
- The waiting hook polls the decision and lets the agent continue only when the final decision allows it.

This is preventative control. It can stop risky activity before it happens.

### Hindsight External-Agent Monitoring

Some SaaS-hosted or platform-hosted agents do not expose a real-time hook surface. Examples include Salesforce Agentforce, Microsoft Copilot Studio / Agent 365, Azure AI Foundry agents, Google Vertex AI / Gemini Enterprise agents, ServiceNow agents, AWS Bedrock AgentCore, Zapier Agents, and similar managed platforms.

For those agents, OpenLeash uses connector workers. A worker periodically connects to each configured provider for each organization, fetches agent inventory, sessions, traces, transcripts, tool calls, and conversation logs where available, normalizes that data into the OpenLeash event model, and evaluates the conversations through the same policy engine.

This mode is retrospective visibility. It usually cannot stop the original action in real time, but it can detect risky behavior, notify admins/users after the fact, create audit records, feed reports, and identify agents or integrations that need policy changes.

The puller is a reliable worker service. It is horizontally scalable, organization-scoped, idempotent, and safe to retry. Connector implementations remain behind provider interfaces rather than imposing a language-specific fork of the event pipeline.

`apps/provider-puller` is the deployable scheduler. Its initial production provider set is Salesforce Agentforce, Google Vertex AI, and Microsoft Copilot Studio. It invokes connector sync concurrently, relies on normalized-event idempotency for safe retries, emits structured per-provider results, and is published as `openleash-provider-puller`.

Expected behavior:

- Organizations authenticate OpenLeash to each provider from the dashboard.
- Provider credentials are stored encrypted, scoped by organization and connector.
- The puller schedules sync jobs per organization/provider/agent.
- Each connector fetches the richest available logs: agent list first, then sessions/traces/transcripts/tool calls.
- Sync checkpoints prevent duplicate ingestion.
- Fetched records are normalized into the same event/evaluation tables used by hook events.
- Risky findings can trigger mobile/desktop/dashboard notifications, clearly labeled as hindsight or past-event findings.

Connector workers are backend services for SaaS agent visibility and should not imply real-time enforcement unless a provider later exposes a true hook/callback.

## Components

### OpenLeash Client

OpenLeash Client is the installed macOS/Windows app. It owns the tray, approval UI, updater, local hook relay, local settings, and CLI/MDM install arguments. The client discovers supported agents and writes user-level hook configuration.

Installed hooks should call the configured managed API directly:

```text
POST https://api.openleash.com/v1/hooks/claude/PreToolUse?user_token=...
```

Private Cloud deployments use the customer-hosted client API:

```text
POST https://api.your-openleash-domain.example/v1/hooks/claude/PreToolUse?user_token=...
```

The endpoint normalizes the raw hook payload, evaluates rules, records the event, and returns the native decision shape expected by the agent. The old local JS hook runtime remains as a compatibility fallback, but HTTP hook endpoints are the primary contract.

For Claude Code, `PreToolUse` returns:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow | deny | ask",
    "permissionDecisionReason": "human-readable reason"
  }
}
```

### API

Managed self-hosted and managed cloud deployments use `client-api` as the managed enforcement brain. It authenticates clients by query-string `user_token` or bearer token, stores every event, loads enabled rules, evaluates those rules, records each policy result, and returns a single aggregate decision.

The desktop client runs a small local `client-api` edge surface on `127.0.0.1:9317` for setup, OAuth callbacks, tray state, local cache, provider transformation, container-plugin execution, and managed-backend relay. It owns no account/policy/audit source of truth and is not the canonical installed hook endpoint because local hook URLs are not reachable when an agent moves execution into a provider cloud.

External agents use the same API evaluation path. Provider connectors fetch the fullest available conversation log from SaaS agent platforms, normalize it into `EvaluationRequest`, and store the result in the same Postgres tables as local agent events.

Current connector surfaces:

- Azure AI Foundry Agent Service: configured through project endpoint, Microsoft Entra bearer token, agent ids, and thread ids. Messages are read from the Agent Service messages API.
- Microsoft Copilot Studio / Agent 365: configured through Dataverse URL/token, agent ids, and conversation transcript ids.
- Salesforce Agentforce: configured through Salesforce OAuth/access token plus Agentforce session trace or transcript export endpoint.
- AWS Bedrock Agents / AgentCore: configured through region, agent ids, session ids, and a trace export URL template until SigV4 is added.
- Google Vertex AI / Gemini Enterprise: configured through project/location/token, Agent Engine ids, and session ids.
- n8n: configured through base URL, API key, workflow ids, and execution ids.
- Zapier Agents / Zapier AI: configured through API key, agent ids, conversation ids, and a transcript URL template.

Decision aggregation:

- any `failed` policy means `deny`
- otherwise any `needs_question` policy means `ask`
- otherwise the event is `allow`

### Dashboard

The Cloud and Private dashboard is a CISO view over Postgres. It shows protected computers, users, active agent runtimes, external agent connectors, highlighted agent actions, recent decisions, denied actions, pending human questions, policy inventory, tokens, and MDM deployment instructions.

Enterprise onboarding follows the older CISO-first dashboard pattern: company setup, identity-provider connection, identity import, RBAC mapping, deployment guidance, and activation. The dashboard talks to Identity Loader through `IDENTITY_LOADER_URL` when it is configured. Without that URL, local development uses deterministic mock users and groups so the onboarding flow still works end to end.

Identity Loader is the bridge from Okta, Microsoft Entra ID, Google Workspace, Ping, or Active Directory into OpenLeash. It syncs users, groups, and group membership into Postgres with organization-scoped upserts, then the dashboard uses those groups for admin/viewer/analyst role assignment and MDM rollout targeting.

### Tray UI

The tray app is part of OpenLeash Client. It polls pending `ask` decisions, opens a compact approval window, sends a desktop notification, and posts allow/deny back to the API. Rules, plugins, audit history, and approval decisions live in the configured backend.

## Data retention

Conversation events and policy decisions are written durably with timestamps. A production deployment should add a retention job keyed by tenant configuration, with 30 days as the default.

## Edition boundaries

See `docs/EDITIONS.md` for the product contract. All editions share OpenLeash Client. OpenLeash Cloud and Private Cloud own rules centrally.
