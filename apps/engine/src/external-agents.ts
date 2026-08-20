import type { AgentKind, ConversationTurn, EvaluationRequest } from "@openleash/shared";

export type ExternalProvider =
  | "azure-ai-foundry"
  | "microsoft-copilot-studio"
  | "salesforce-agentforce"
  | "aws-bedrock-agentcore"
  | "google-vertex-ai"
  | "n8n"
  | "zapier-agents"
  | "openai-codex-cloud";

export type ExternalConnectorStatus = {
  provider: ExternalProvider;
  label: string;
  configured: boolean;
  missing: string[];
  agents: ExternalAgentSummary[];
  notes: string[];
};

export type ExternalAgentSummary = {
  provider: ExternalProvider;
  id: string;
  displayName: string;
  status: "ready" | "missing_credentials" | "configured";
  source: string;
  conversationIds?: string[];
};

export type ExternalConversation = {
  provider: ExternalProvider;
  agentId: string;
  agentName: string;
  sessionId: string;
  userName?: string;
  userEmail?: string;
  occurredAt: string;
  transcript: ConversationTurn[];
  raw: unknown;
};

type ProviderDefinition = {
  provider: ExternalProvider;
  label: string;
  requiredEnv: string[];
  agentIdEnv: string;
  agentIdsEnv: string;
  agentsJsonEnv: string;
  conversationIdsEnv: string;
  conversationLabel: string;
  notes: string[];
  listRemoteAgents?: () => Promise<ExternalAgentSummary[]>;
  fetchRawConversation?: (sessionId: string, agentId: string) => Promise<unknown>;
};

const providerDefinitions: ProviderDefinition[] = [
  {
    provider: "azure-ai-foundry",
    label: "Microsoft Azure AI Foundry Agent Service",
    requiredEnv: ["AZURE_AI_FOUNDRY_PROJECT_ENDPOINT", "AZURE_AI_FOUNDRY_TOKEN"],
    agentIdEnv: "AZURE_AI_FOUNDRY_AGENT_ID",
    agentIdsEnv: "AZURE_AI_FOUNDRY_AGENT_IDS",
    agentsJsonEnv: "AZURE_AI_FOUNDRY_AGENTS_JSON",
    conversationIdsEnv: "AZURE_AI_FOUNDRY_THREAD_IDS",
    conversationLabel: "threads",
    notes: ["Uses Azure AI Foundry Agent Service REST API with Microsoft Entra bearer token."],
    listRemoteAgents: azureListAgents,
    fetchRawConversation: (threadId) => azureListMessages(threadId)
  },
  {
    provider: "microsoft-copilot-studio",
    label: "Microsoft Copilot Studio / Agent 365",
    requiredEnv: ["MICROSOFT_COPILOT_DATAVERSE_URL", "MICROSOFT_COPILOT_DATAVERSE_TOKEN"],
    agentIdEnv: "MICROSOFT_COPILOT_AGENT_ID",
    agentIdsEnv: "MICROSOFT_COPILOT_AGENT_IDS",
    agentsJsonEnv: "MICROSOFT_COPILOT_AGENTS_JSON",
    conversationIdsEnv: "MICROSOFT_COPILOT_CONVERSATION_IDS",
    conversationLabel: "transcripts",
    notes: [
      "Reads Copilot Studio transcripts from Dataverse ConversationTranscript or a configured transcript URL template.",
      "Agent 365 governance is represented here as the Microsoft-managed agent surface; transcript retrieval still depends on Copilot Studio/Dataverse access."
    ],
    fetchRawConversation: (conversationId) => microsoftCopilotTranscript(conversationId)
  },
  {
    provider: "salesforce-agentforce",
    label: "Salesforce Agentforce",
    requiredEnv: ["SALESFORCE_INSTANCE_URL", "SALESFORCE_ACCESS_TOKEN"],
    agentIdEnv: "SALESFORCE_AGENTFORCE_AGENT_ID",
    agentIdsEnv: "SALESFORCE_AGENTFORCE_AGENT_IDS",
    agentsJsonEnv: "SALESFORCE_AGENTFORCE_AGENTS_JSON",
    conversationIdsEnv: "SALESFORCE_AGENTFORCE_SESSION_IDS",
    conversationLabel: "sessions",
    notes: [
      "Uses Salesforce OAuth/access token plus Agentforce session trace or transcript export.",
      "Set SALESFORCE_AGENTFORCE_TRACE_URL_TEMPLATE when your org exposes session tracing export."
    ],
    fetchRawConversation: (sessionId) => fetchSalesforceSessionTrace(sessionId)
  },
  {
    provider: "aws-bedrock-agentcore",
    label: "AWS Bedrock Agents / AgentCore",
    requiredEnv: ["AWS_REGION", "AWS_BEDROCK_AGENTCORE_TRACE_URL_TEMPLATE"],
    agentIdEnv: "AWS_BEDROCK_AGENT_ID",
    agentIdsEnv: "AWS_BEDROCK_AGENT_IDS",
    agentsJsonEnv: "AWS_BEDROCK_AGENTS_JSON",
    conversationIdsEnv: "AWS_BEDROCK_SESSION_IDS",
    conversationLabel: "sessions",
    notes: [
      "AgentCore observability data lives in CloudWatch/AgentCore traces. OpenLeash supports a trace URL template until AWS credentials/SigV4 are wired with the AWS SDK.",
      "Set AWS_BEDROCK_AGENTCORE_TRACE_URL_TEMPLATE for direct transcript or trace retrieval."
    ],
    fetchRawConversation: (sessionId, agentId) => fetchTemplateJson("AWS_BEDROCK_AGENTCORE_TRACE_URL_TEMPLATE", {
      sessionId,
      agentId,
      region: process.env.AWS_REGION ?? ""
    })
  },
  {
    provider: "google-vertex-ai",
    label: "Google Vertex AI / Gemini Enterprise",
    requiredEnv: ["GOOGLE_CLOUD_PROJECT_ID", "GOOGLE_CLOUD_LOCATION", "GOOGLE_VERTEX_AI_ACCESS_TOKEN"],
    agentIdEnv: "GOOGLE_VERTEX_AGENT_ENGINE_ID",
    agentIdsEnv: "GOOGLE_VERTEX_AGENT_ENGINE_IDS",
    agentsJsonEnv: "GOOGLE_VERTEX_AGENTS_JSON",
    conversationIdsEnv: "GOOGLE_VERTEX_SESSION_IDS",
    conversationLabel: "sessions",
    notes: [
      "Uses Vertex AI Agent Engine sessions/events API with a Google Cloud bearer token.",
      "Gemini Enterprise deployments can use GOOGLE_VERTEX_TRANSCRIPT_URL_TEMPLATE when their transcript surface differs."
    ],
    fetchRawConversation: (sessionId, agentId) => googleVertexSessionEvents(sessionId, agentId)
  },
  {
    provider: "n8n",
    label: "n8n",
    requiredEnv: ["N8N_BASE_URL", "N8N_API_KEY"],
    agentIdEnv: "N8N_WORKFLOW_ID",
    agentIdsEnv: "N8N_WORKFLOW_IDS",
    agentsJsonEnv: "N8N_AGENTS_JSON",
    conversationIdsEnv: "N8N_EXECUTION_IDS",
    conversationLabel: "executions",
    notes: ["Supports n8n Cloud and self-hosted/on-prem Docker through the n8n REST executions API."],
    fetchRawConversation: (executionId) => n8nExecution(executionId)
  },
  {
    provider: "openai-codex-cloud",
    label: "OpenAI Codex Cloud",
    requiredEnv: ["OPENAI_CODEX_CLOUD_TOKEN"],
    agentIdEnv: "OPENAI_CODEX_AGENT_ID",
    agentIdsEnv: "OPENAI_CODEX_AGENT_IDS",
    agentsJsonEnv: "OPENAI_CODEX_AGENTS_JSON",
    conversationIdsEnv: "OPENAI_CODEX_TASK_IDS",
    conversationLabel: "tasks",
    notes: [
      "Represents hosted Codex tasks/remote agent runs. Wire OPENAI_CODEX_TASK_TRANSCRIPT_URL_TEMPLATE when transcript export is available for the tenant.",
      "Until OpenAI exposes a stable remote hook callback, OpenLeash treats Codex Cloud as an external-agent transcript sync source."
    ],
    fetchRawConversation: (taskId, agentId) => fetchTemplateJson("OPENAI_CODEX_TASK_TRANSCRIPT_URL_TEMPLATE", {
      taskId,
      sessionId: taskId,
      agentId
    }, { authorization: `Bearer ${process.env.OPENAI_CODEX_CLOUD_TOKEN}` })
  },
  {
    provider: "zapier-agents",
    label: "Zapier Agents / Zapier AI",
    requiredEnv: ["ZAPIER_API_KEY", "ZAPIER_AGENT_TRANSCRIPT_URL_TEMPLATE"],
    agentIdEnv: "ZAPIER_AGENT_ID",
    agentIdsEnv: "ZAPIER_AGENT_IDS",
    agentsJsonEnv: "ZAPIER_AGENTS_JSON",
    conversationIdsEnv: "ZAPIER_CONVERSATION_IDS",
    conversationLabel: "conversations",
    notes: [
      "Zapier AI Actions are API-key based; Zapier Agents transcript access depends on the workspace surface.",
      "Set ZAPIER_AGENT_TRANSCRIPT_URL_TEMPLATE when Zapier exposes or exports agent conversation logs for your account."
    ],
    fetchRawConversation: (conversationId, agentId) => fetchTemplateJson("ZAPIER_AGENT_TRANSCRIPT_URL_TEMPLATE", {
      conversationId,
      sessionId: conversationId,
      agentId
    }, { authorization: `Bearer ${process.env.ZAPIER_API_KEY}` })
  }
];

export const EXTERNAL_PROVIDER_IDS = providerDefinitions.map((definition) => definition.provider);

export function externalProviderLabel(provider: string) {
  return providerDefinitions.find((definition) => definition.provider === provider)?.label ?? "SaaS agents";
}

export async function listExternalConnectors(): Promise<ExternalConnectorStatus[]> {
  return Promise.all(providerDefinitions.map(listConnector));
}

export async function fetchConfiguredExternalConversations(provider?: ExternalProvider): Promise<ExternalConversation[]> {
  const definitions = provider
    ? providerDefinitions.filter((definition) => definition.provider === provider)
    : providerDefinitions;
  const results = await Promise.all(definitions.map(fetchProviderConversations));
  return results.flat();
}

export function externalConversationToEvaluation(conversation: ExternalConversation): EvaluationRequest {
  const latestUser = [...conversation.transcript].reverse().find((turn) => turn.role === "user")?.content;
  const latestAssistant = [...conversation.transcript].reverse().find((turn) => turn.role === "assistant")?.content;
  const agentKind: AgentKind = conversation.provider;
  return {
    computer: {
      hostname: `${conversation.provider}.external`,
      platform: "external-agent-platform",
      osRelease: "managed"
    },
    agent: {
      kind: agentKind,
      displayName: conversation.agentName
    },
    event: {
      eventName: "UserPromptSubmit",
      agentKind,
      sessionId: conversation.sessionId,
      projectPath: conversation.provider,
      transcript: conversation.transcript,
      prompt: latestUser ?? latestAssistant ?? "",
      raw: {
        provider: conversation.provider,
        externalAgentId: conversation.agentId,
        externalSessionId: conversation.sessionId,
        externalUserName: conversation.userName,
        externalUserEmail: conversation.userEmail,
        externalEvaluationKey: externalEvaluationKey(conversation),
        sourcePayload: conversation.raw
      },
      occurredAt: conversation.occurredAt
    }
  };
}

export function externalEvaluationKey(conversation: ExternalConversation) {
  return `${conversation.provider}:${conversation.agentId}:${conversation.sessionId}:${conversation.occurredAt}`;
}

async function listConnector(definition: ProviderDefinition): Promise<ExternalConnectorStatus> {
  const missing = missingEnv(definition.requiredEnv);
  const configured = missing.length === 0;
  const notes = [...definition.notes];
  let agents = configuredAgents(definition, configured);
  if (configured && definition.listRemoteAgents) {
    try {
      const remote = await definition.listRemoteAgents();
      if (remote.length > 0) agents = remote;
    } catch (error) {
      notes.push(`${definition.label} list failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return {
    provider: definition.provider,
    label: definition.label,
    configured: configured || agents.length > 0,
    missing,
    agents,
    notes
  };
}

function configuredAgents(definition: ProviderDefinition, configured: boolean): ExternalAgentSummary[] {
  const explicit = parseJsonArray(definition.agentsJsonEnv);
  if (explicit.length > 0) {
    return explicit.map((agent, index) => ({
      provider: definition.provider,
      id: String((agent as { id?: unknown }).id ?? (agent as { developerName?: unknown }).developerName ?? `${definition.provider}-${index + 1}`),
      displayName: String((agent as { name?: unknown }).name ?? (agent as { label?: unknown }).label ?? definition.label),
      status: configured ? "configured" : "missing_credentials",
      source: definition.agentsJsonEnv,
      conversationIds: csv(process.env[definition.conversationIdsEnv])
    }));
  }
  const ids = csv(process.env[definition.agentIdsEnv] ?? process.env[definition.agentIdEnv]);
  return ids.map((id) => ({
    provider: definition.provider,
    id,
    displayName: id,
    status: configured ? "ready" : "missing_credentials",
    source: ids.length > 1 ? definition.agentIdsEnv : definition.agentIdEnv,
    conversationIds: csv(process.env[definition.conversationIdsEnv])
  }));
}

async function fetchProviderConversations(definition: ProviderDefinition): Promise<ExternalConversation[]> {
  const sessions = csv(process.env[definition.conversationIdsEnv]);
  if (sessions.length === 0 || !definition.fetchRawConversation || missingEnv(definition.requiredEnv).length > 0) return [];
  const agents = configuredAgents(definition, true);
  const fallbackAgent = agents[0] ?? {
    id: process.env[definition.agentIdEnv] ?? definition.provider,
    displayName: definition.label
  };
  return Promise.all(sessions.map(async (sessionId) => {
    const raw = await definition.fetchRawConversation?.(sessionId, fallbackAgent.id);
    return normalizeExternalConversation({
      provider: definition.provider,
      agentId: fallbackAgent.id,
      agentName: fallbackAgent.displayName,
      sessionId,
      raw: raw ?? { id: sessionId, messages: [] }
    });
  }));
}

async function azureListAgents(): Promise<ExternalAgentSummary[]> {
  const endpoints = ["/assistants", "/agents"];
  for (const route of endpoints) {
    const body = await azureGetJson(route).catch(() => undefined);
    const data = arrayFromBody(body);
    if (data.length > 0) {
      return data.map((agent) => {
        const record = agent as Record<string, unknown>;
        const id = String(record.id ?? record.assistant_id ?? record.name ?? "azure-agent");
        return {
          provider: "azure-ai-foundry",
          id,
          displayName: String(record.name ?? record.display_name ?? id),
          status: "ready",
          source: "azure-api",
          conversationIds: csv(process.env.AZURE_AI_FOUNDRY_THREAD_IDS)
        };
      });
    }
  }
  return [];
}

async function azureListMessages(threadId: string) {
  return azureGetJson(`/threads/${encodeURIComponent(threadId)}/messages`, { limit: "100", order: "desc" });
}

async function azureGetJson(route: string, query: Record<string, string> = {}) {
  const endpoint = (process.env.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT ?? "").replace(/\/+$/, "");
  const params = new URLSearchParams({ "api-version": process.env.AZURE_AI_FOUNDRY_API_VERSION ?? "v1", ...query });
  return fetchJson(`${endpoint}${route}?${params.toString()}`, {
    authorization: `Bearer ${process.env.AZURE_AI_FOUNDRY_TOKEN}`
  }, "Azure");
}

async function microsoftCopilotTranscript(conversationId: string) {
  const template = process.env.MICROSOFT_COPILOT_TRANSCRIPT_URL_TEMPLATE;
  if (template) {
    return fetchTemplateJson("MICROSOFT_COPILOT_TRANSCRIPT_URL_TEMPLATE", {
      conversationId,
      sessionId: conversationId,
      dataverseUrl: process.env.MICROSOFT_COPILOT_DATAVERSE_URL ?? ""
    }, { authorization: `Bearer ${process.env.MICROSOFT_COPILOT_DATAVERSE_TOKEN}` });
  }
  const base = (process.env.MICROSOFT_COPILOT_DATAVERSE_URL ?? "").replace(/\/+$/, "");
  const filter = encodeURIComponent(`conversationid eq '${conversationId}'`);
  return fetchJson(`${base}/api/data/v9.2/conversationtranscripts?$filter=${filter}`, {
    authorization: `Bearer ${process.env.MICROSOFT_COPILOT_DATAVERSE_TOKEN}`,
    accept: "application/json"
  }, "Microsoft Copilot");
}

async function fetchSalesforceSessionTrace(sessionId: string) {
  return fetchTemplateJson("SALESFORCE_AGENTFORCE_TRACE_URL_TEMPLATE", {
    instanceUrl: (process.env.SALESFORCE_INSTANCE_URL ?? "").replace(/\/+$/, ""),
    sessionId
  }, { authorization: `Bearer ${process.env.SALESFORCE_ACCESS_TOKEN}` }, { id: sessionId, messages: [] });
}

async function googleVertexSessionEvents(sessionId: string, agentId: string) {
  if (process.env.GOOGLE_VERTEX_TRANSCRIPT_URL_TEMPLATE) {
    return fetchTemplateJson("GOOGLE_VERTEX_TRANSCRIPT_URL_TEMPLATE", {
      sessionId,
      agentId,
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID ?? "",
      location: process.env.GOOGLE_CLOUD_LOCATION ?? ""
    }, { authorization: `Bearer ${process.env.GOOGLE_VERTEX_AI_ACCESS_TOKEN}` });
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = process.env.GOOGLE_CLOUD_LOCATION;
  const engine = agentId || process.env.GOOGLE_VERTEX_AGENT_ENGINE_ID;
  const base = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/reasoningEngines/${engine}`;
  return fetchJson(`${base}/sessions/${encodeURIComponent(sessionId)}/events`, {
    authorization: `Bearer ${process.env.GOOGLE_VERTEX_AI_ACCESS_TOKEN}`
  }, "Google Vertex AI");
}

async function n8nExecution(executionId: string) {
  const base = (process.env.N8N_BASE_URL ?? "").replace(/\/+$/, "");
  return fetchJson(`${base}/api/v1/executions/${encodeURIComponent(executionId)}?includeData=true`, {
    "x-n8n-api-key": process.env.N8N_API_KEY ?? ""
  }, "n8n");
}

async function fetchTemplateJson(
  envName: string,
  values: Record<string, string>,
  headers: Record<string, string> = {},
  fallback?: unknown
) {
  const template = process.env[envName];
  if (!template) {
    if (fallback !== undefined) return fallback;
    return { messages: [] };
  }
  const url = Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, encodeURIComponent(value)),
    template
  );
  return fetchJson(url, headers, envName);
}

async function fetchJson(url: string, headers: Record<string, string>, label: string) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  return response.json();
}

function normalizeExternalConversation(input: {
  provider: ExternalProvider;
  agentId: string;
  agentName: string;
  sessionId: string;
  raw: unknown;
}): ExternalConversation {
  const transcript = extractTranscript(input.raw);
  return {
    provider: input.provider,
    agentId: input.agentId,
    agentName: input.agentName,
    sessionId: input.sessionId,
    occurredAt: transcript.at(-1)?.at ?? new Date().toISOString(),
    transcript,
    raw: input.raw
  };
}

function extractTranscript(raw: unknown): ConversationTurn[] {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const candidates = [
    record.messages,
    record.conversation,
    record.turns,
    record.transcript,
    record.data,
    record.value,
    record.events,
    record.result,
    record.executionData,
    record.workflowData
  ];
  const source = candidates.find(Array.isArray) as unknown[] | undefined;
  if (source) return source.map(transcriptTurn).filter((turn): turn is ConversationTurn => Boolean(turn)).slice(-100);

  const chatTranscript = contentText(record.ChatTranscript ?? record.chatTranscript ?? record.transcriptText);
  if (chatTranscript) return transcriptFromText(chatTranscript);

  const flattened = flattenInterestingText(raw);
  return flattened ? [{ role: "system", content: flattened.slice(0, 8000), at: new Date().toISOString() }] : [];
}

function transcriptTurn(item: unknown): ConversationTurn | undefined {
  if (!item || typeof item !== "object") return undefined;
  const message = item as Record<string, unknown>;
  const role = normalizeRole(
    message.role ??
    message.author_role ??
    message.sender ??
    message.type ??
    message.source ??
    message.speaker
  );
  const content = contentText(
    message.content ??
    message.text ??
    message.message ??
    message.body ??
    message.input ??
    message.output ??
    message.response ??
    message.ChatTranscript
  );
  if (!role || !content) return undefined;
  const at = isoTime(message.created_at ?? message.createdAt ?? message.timestamp ?? message.time ?? message.startTime);
  return {
    role,
    content,
    ...(at ? { at } : {})
  };
}

function transcriptFromText(value: string): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const segments = value.split(/(?=(?:User|Customer|Agent|Assistant|Bot)\s+(?:says|said):)/i).filter(Boolean);
  for (const segment of segments) {
    const role = /^(\s*(user|customer))/i.test(segment) ? "user" : /^(\s*(agent|assistant|bot))/i.test(segment) ? "assistant" : undefined;
    const content = segment.replace(/^\s*(User|Customer|Agent|Assistant|Bot)\s+(says|said):\s*/i, "").trim();
    if (role && content) turns.push({ role, content });
  }
  return turns.length ? turns.slice(-100) : [{ role: "system", content: value.slice(0, 8000) }];
}

function normalizeRole(value: unknown): ConversationTurn["role"] | undefined {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("user") || text.includes("customer") || text.includes("human")) return "user";
  if (text.includes("assistant") || text.includes("agent") || text.includes("bot") || text.includes("model")) return "assistant";
  if (text.includes("tool") || text.includes("function") || text.includes("node")) return "tool";
  if (text.includes("system") || text.includes("trace") || text.includes("execution")) return "system";
  return undefined;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n").trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return contentText(record.text ?? record.value ?? record.content ?? record.message ?? record.body);
}

function flattenInterestingText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenInterestingText).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return Object.entries(record)
    .filter(([key]) => /prompt|message|input|output|response|trace|transcript|tool|node|error|data|content|text/i.test(key))
    .map(([key, item]) => `${key}: ${flattenInterestingText(item)}`)
    .filter((item) => item.trim().length > 0)
    .join("\n");
}

function isoTime(value: unknown) {
  const date =
    typeof value === "number"
      ? new Date(value > 10_000_000_000 ? value : value * 1000)
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : undefined;
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function arrayFromBody(body: unknown) {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  for (const key of ["data", "value", "agents", "assistants", "items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function missingEnv(names: string[]) {
  return names.filter((name) => !process.env[name]);
}

function parseJsonArray(envName: string) {
  const value = process.env[envName];
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function csv(value?: string) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
