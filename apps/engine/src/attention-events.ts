import type { OpenLeashAttentionEvent } from "@openleash/shared";

type AttentionRow = Record<string, any>;

export function buildAttentionEvents(input: {
  pending: AttentionRow[];
  blocked: AttentionRow[];
  activity: AttentionRow[];
}): OpenLeashAttentionEvent[] {
  const pending = input.pending.map(attentionEventForPending);
  const blocked = input.blocked.map((row) => ({
    schemaVersion: "2026-07-19.v1" as const,
    id: `blocked:${row.id}`,
    kind: "blocked" as const,
    state: "resolved" as const,
    title: `${row.agent_name ?? "Agent"} was blocked`,
    body: row.summary ?? "Leash blocked an agent action.",
    createdAt: isoValue(row.created_at),
    agent: attentionAgent(row),
    session: attentionSession(row),
  }));
  const completions = input.activity
    .filter((row) =>
      ["Stop", "SessionEnd", "SubagentStop"].includes(
        String(row.event_name ?? ""),
      ),
    )
    .map((row) => ({
      schemaVersion: "2026-07-19.v1" as const,
      id: `completed:${row.id}`,
      kind:
        row.event_name === "SubagentStop"
          ? ("subagent_completed" as const)
          : ("completed" as const),
      state: "resolved" as const,
      title: `${row.agent_name ?? "Agent"} finished`,
      body:
        eventPrompt(row.payload) ??
        row.summary ??
        "The agent finished its latest turn.",
      createdAt: isoValue(row.created_at),
      agent: attentionAgent(row),
      session: attentionSession(row),
    }));
  const seen = new Set<string>();
  return [...pending, ...blocked, ...completions].filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

export function attentionEventForPending(
  row: AttentionRow,
): OpenLeashAttentionEvent {
  const toolName = String(row.tool_name ?? "");
  const event = eventRecord(row.payload);
  const toolInput = event?.tool?.input;
  const kind = attentionKindForTool(toolName);
  return {
    schemaVersion: "2026-07-19.v1",
    id: `pending:${row.id}`,
    decisionId: String(row.id),
    kind,
    state: "waiting",
    title:
      kind === "question"
        ? `${row.agent_name ?? "Agent"} asks`
        : kind === "plan_review"
          ? `${row.agent_name ?? "Agent"} has a plan`
          : `Allow ${row.agent_name ?? "agent"}?`,
    body: row.summary ?? row.question ?? "An agent is waiting for you.",
    createdAt: isoValue(row.created_at),
    agent: attentionAgent(row),
    session: attentionSession(row),
    interaction:
      kind === "question"
        ? {
            type: "questions",
            originalInput:
              toolInput && typeof toolInput === "object" ? toolInput : {},
            questions: normalizeAttentionQuestions(toolInput),
          }
        : kind === "plan_review"
          ? {
              type: "plan",
              markdown: planMarkdown(toolInput, event?.raw),
              originalInput:
                toolInput && typeof toolInput === "object" ? toolInput : {},
            }
          : { type: "approval" },
  };
}

export function attentionKindForTool(
  toolName: string,
): "approval" | "question" | "plan_review" {
  if (/^AskUserQuestion$/i.test(toolName)) return "question";
  if (/^ExitPlanMode$/i.test(toolName)) return "plan_review";
  return "approval";
}

function attentionAgent(row: AttentionRow) {
  return {
    kind: String(row.agent_kind ?? "unknown"),
    name: String(row.agent_name ?? "AI agent"),
    hostname: String(row.hostname ?? "cloud"),
  };
}

function attentionSession(row: AttentionRow) {
  const event = eventRecord(row.payload);
  return {
    id: String(event?.sessionId ?? event?.raw?.session_id ?? "unknown"),
    projectPath: row.project_path ?? event?.projectPath ?? undefined,
  };
}

function eventRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

function eventPrompt(value: unknown) {
  const event = eventRecord(value);
  const prompt = firstString(
    event?.prompt,
    event?.raw?.last_assistant_message,
    event?.raw?.prompt_response,
    event?.raw?.message,
  );
  return prompt ? truncate(cleanContextText(prompt), 180) : undefined;
}

function normalizeAttentionQuestions(input: unknown) {
  const record = eventRecord(input);
  const questions = Array.isArray(record?.questions) ? record.questions : [];
  return questions
    .filter((item): item is Record<string, any> => Boolean(eventRecord(item)))
    .slice(0, 4)
    .map((item) => ({
      question: String(item.question ?? "").trim(),
      header: String(item.header ?? "Question").trim().slice(0, 40),
      multiSelect: Boolean(item.multiSelect ?? item.multiple),
      options: (Array.isArray(item.options) ? item.options : [])
        .filter((option): option is Record<string, any> =>
          Boolean(eventRecord(option)),
        )
        .slice(0, 12)
        .map((option) => ({
          label: String(option.label ?? "").trim(),
          description:
            typeof option.description === "string"
              ? option.description.trim()
              : undefined,
        }))
        .filter((option) => option.label),
    }))
    .filter((item) => item.question);
}

function planMarkdown(input: unknown, raw: unknown) {
  const toolInput = eventRecord(input);
  const rawInput = eventRecord(raw);
  return firstString(
    toolInput?.plan,
    toolInput?.content,
    toolInput?.planContent,
    rawInput?.plan,
    rawInput?.plan_content,
    rawInput?.planContent,
  );
}

function firstString(...values: unknown[]) {
  return values.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  )?.trim();
}

function cleanContextText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function isoValue(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}
