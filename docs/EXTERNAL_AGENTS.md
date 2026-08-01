# External Agent Monitoring

OpenLeash Cloud and Private can monitor AI agents beyond local coding tools. Local or hook-capable agents can use real-time hooks, while personal autonomous agents and SaaS-hosted platforms can be monitored by syncing conversation logs into the same policy evaluation path used by local agent hooks.

External-agent monitoring is not the same as real-time desktop hook interception. For hook-capable agents, OpenLeash can block or pause before an action happens. For most managed SaaS agent platforms, OpenLeash works in hindsight: it periodically pulls logs, traces, sessions, and transcripts from provider APIs, evaluates them, and reports risky activity after it happened.

The long-term production shape is a provider puller service:

- runs as a backend worker, separate from the desktop client
- iterates organizations and configured provider connections
- loads encrypted organization/provider credentials
- syncs agent inventory and conversation/session checkpoints
- fetches transcript, trace, tool-call, and execution details when the provider exposes them
- normalizes records into OpenLeash conversation events
- evaluates those events with the normal policy engine
- emits dashboard/mobile/desktop findings for risky past events

The puller must be idempotent and checkpointed. A failed sync should be safe to retry without duplicating events. Provider credentials should be stored per organization and per connector, encrypted at rest, rotated from the dashboard, and never stored in the desktop client.

## Connector Targets

Connector support covers production-ready integrations, local/mock integrations, and planned provider surfaces as vendors expose stable transcript, trace, hook, or export APIs. The goal is one OpenLeash policy and audit model across local development agents, personal autonomous agents such as OpenClaw and NanoClawf, and SaaS agent platforms.

- Azure AI Foundry Agent Service
- Microsoft Copilot Studio / Agent 365
- Salesforce Agentforce
- AWS Bedrock Agents / AgentCore
- Google Vertex AI / Gemini Enterprise
- ServiceNow agents
- n8n Cloud and self-hosted/on-prem Docker
- Zapier Agents / Zapier AI
- OpenAI Codex Cloud / hosted Codex tasks

## API

List configured connectors and already-synced external runtimes:

```sh
curl http://localhost:9319/admin/external-agents
```

Sync configured conversations:

```sh
curl -X POST http://localhost:9319/admin/external-agents/sync \
  -H 'content-type: application/json' \
  -d '{}'
```

Sync one provider:

```sh
curl -X POST http://localhost:9319/admin/external-agents/sync \
  -H 'content-type: application/json' \
  -d '{"provider":"azure-ai-foundry"}'
```

## Credentials

Fill `docs/external-agent-keys.required.env` and copy the values into the deployment environment.

For local UI/API testing without vendor credentials:

```env
OPENLEASH_EXTERNAL_AGENTS_MOCK=true
```

## Notes

Every connector uses the same shape:

- authenticate OpenLeash to the provider from the dashboard
- store encrypted organization-scoped provider credentials
- discover or set agent/workflow ids, either as CSV ids or JSON objects
- maintain conversation/session/thread/execution checkpoints
- run the puller or `/admin/external-agents/sync` in local development

Provider JSON variables such as `*_AGENTS_JSON` accept:

```json
[{"id":"agent-id","name":"Friendly agent name"}]
```

Azure AI Foundry has an Agent Service REST API for agents, threads, runs, run steps, and messages. OpenLeash reads configured thread ids and calls the messages endpoint. Reference: https://learn.microsoft.com/en-us/rest/api/aifoundry/aiagents/messages/list-messages

Microsoft Copilot Studio / Agent 365 reads Dataverse conversation transcripts by default. If the tenant exposes a different export endpoint, set `MICROSOFT_COPILOT_TRANSCRIPT_URL_TEMPLATE`. Reference: https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-transcript-controls

Salesforce Agentforce exposes several surfaces depending on org setup: Agent API/SDK sessions, session tracing export, and conversation transcript actions. OpenLeash supports a configurable trace URL template so the exact org endpoint can be wired without changing the policy engine. Reference: https://help.salesforce.com/s/articleView?id=ai.generative_ai_session_trace.htm&type=5

AWS Bedrock Agents / AgentCore tracing is exposed through AWS observability surfaces. Until SigV4/AWS SDK integration is added, set `AWS_BEDROCK_AGENTCORE_TRACE_URL_TEMPLATE` to an internal endpoint/export that returns trace or transcript JSON. Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-telemetry.html

Google Vertex AI / Gemini Enterprise uses Vertex AI Agent Engine session events when possible. Set `GOOGLE_VERTEX_TRANSCRIPT_URL_TEMPLATE` when the tenant transcript surface differs. Reference: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/sessions/overview

n8n uses `/api/v1/executions/{executionId}?includeData=true` and supports both n8n Cloud and self-hosted instances. Reference: https://docs.n8n.io/api/

Zapier Agents / Zapier AI currently needs a transcript URL template for the workspace-specific log/export surface. Zapier API-key auth is sent as a bearer token. Reference: https://docs.zapier.com/platform/reference/ai-actions

OpenAI Codex Cloud is modeled as an external-agent transcript sync source until a stable remote hook callback is available. Configure `OPENAI_CODEX_CLOUD_TOKEN`, `OPENAI_CODEX_TASK_IDS`, and `OPENAI_CODEX_TASK_TRANSCRIPT_URL_TEMPLATE` for the tenant-specific task transcript export.
