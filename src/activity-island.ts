export type ActivityIslandEvent = {
  event_name?: string;
  tool_name?: string;
  prompt?: string;
  summary?: string;
  created_at?: string;
};

export type ActivityIslandSourceSession = {
  id: string;
  session_id?: string;
  title?: string;
  summary?: string;
  project_path?: string;
  started_at?: string;
  last_activity_at?: string;
  duration_seconds?: number;
  event_count?: number;
  events?: ActivityIslandEvent[];
};

export type ActivityIslandSourceAgent = {
  kind: string;
  display_name: string;
  hostname?: string;
  event_name?: string;
  tool_name?: string;
  project_path?: string;
  activity_at?: string;
  short_summary?: string;
  sessions?: ActivityIslandSourceSession[];
};

export type ActiveAgentSession = {
  id: string;
  sessionId: string;
  sourceSessionIds: string[];
  agentKind: string;
  agentName: string;
  projectPath?: string;
  project: string;
  title: string;
  summary: string;
  latestAction: string;
  lastActivityAt: string;
  durationSeconds: number;
  eventCount: number;
  events: ActivityIslandEvent[];
  visualState: "processing" | "running" | "waiting";
};

export type AgentAttentionTarget = {
  agentKind?: string;
  projectPath?: string;
  sessionId?: string;
};

const TERMINAL_EVENTS = new Set(["sessionend", "stop", "completed", "agentstop"]);

export function activeAgentSessions(
  agents: ActivityIslandSourceAgent[],
  now = Date.now(),
  activeWithinMs = 2 * 60_000,
): ActiveAgentSession[] {
  const sessions = agents.flatMap((agent) => {
    const sessions = agent.sessions?.length ? agent.sessions : [syntheticSession(agent)];
    return sessions.flatMap((session, index) => {
      const lastActivityAt = session.last_activity_at ?? agent.activity_at;
      if (!lastActivityAt || !isRecent(lastActivityAt, now, activeWithinMs)) return [];
      const sourceEvents = session.events ?? [];
      const visibleEvents = sourceEvents.filter((event) => !isClaudeStatusPrompt(agent, {
        ...event,
        prompt: event.prompt ?? session.title,
      }));
      if (sourceEvents.length > 0 && visibleEvents.length === 0) return [];
      const latestEvent = visibleEvents[0];
      const latestPrompt = visibleEvents.find((event) => userFacingText(event.prompt));
      const eventName = latestEvent?.event_name ?? (index === 0 ? agent.event_name : undefined);
      if (!latestEvent && isClaudeStatusPrompt(agent, { event_name: eventName, prompt: session.title ?? agent.short_summary })) return [];
      if (eventName && TERMINAL_EVENTS.has(eventName.toLowerCase())) return [];
      const projectPath = session.project_path ?? agent.project_path;
      return [{
        id: session.id,
        sessionId: session.session_id ?? session.id,
        sourceSessionIds: [session.session_id ?? session.id],
        agentKind: agent.kind,
        agentName: agent.display_name,
        projectPath,
        project: projectName(projectPath),
        title: userFacingText(latestPrompt?.prompt) || userFacingText(session.title) || userFacingText(agent.short_summary) || "Agent working",
        summary: friendlySummary(session.summary) || userFacingText(agent.short_summary) || "Agent is working",
        latestAction: latestAction(latestEvent, agent),
        lastActivityAt,
        durationSeconds: Math.max(0, Number(session.duration_seconds ?? 0)),
        eventCount: Math.max(1, Number(session.event_count ?? session.events?.length ?? 1)),
        events: visibleEvents.map(sanitizeEvent).slice(0, 5),
        visualState: activeVisualState(latestEvent, agent),
      }];
    });
  }).sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt));
  return dedupeSessions(sessions);
}

export function prioritizeAgentSessions(
  sessions: ActiveAgentSession[],
  attention?: AgentAttentionTarget,
) {
  return sessions
    .map((session) => attentionMatchesSession(attention, session)
      ? { ...session, visualState: "waiting" as const }
      : session)
    .sort((left, right) => {
      const stateDifference = visualStatePriority(right.visualState) - visualStatePriority(left.visualState);
      if (stateDifference) return stateDifference;
      return Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
    });
}

export function activityIslandKey(sessions: ActiveAgentSession[]) {
  return `activity:${sessions.map((session) => session.id).sort().join("|")}`;
}

export function excludeCompletedAgentSessions(
  sessions: ActiveAgentSession[],
  completedAtBySessionId: ReadonlyMap<string, number>,
) {
  return sessions.filter((session) => {
    const completedAt = Math.max(
      0,
      ...session.sourceSessionIds.map((sessionId) => completedAtBySessionId.get(sessionId) ?? 0),
    );
    return completedAt === 0 || Date.parse(session.lastActivityAt) > completedAt;
  });
}

export function contributionsForSession(
  contributions: PluginIslandContribution[],
  sessionIds: string | string[],
) {
  const ids = new Set(Array.isArray(sessionIds) ? sessionIds : [sessionIds]);
  return contributions.filter((contribution) =>
    (contribution.sessionId ? ids.has(contribution.sessionId) : false) ||
    contribution.relatedSessionIds?.some((sessionId) => ids.has(sessionId))
  );
}

export function ambientIslandContributions(
  contributions: PluginIslandContribution[],
  activeSessionIds: string[] = [],
) {
  const active = new Set(activeSessionIds);
  return contributions.filter((contribution) => {
    if (!contribution.sessionId && !(contribution.relatedSessionIds?.length)) return true;
    if (contribution.sessionId && active.has(contribution.sessionId)) return false;
    if (contribution.relatedSessionIds?.some((sessionId) => active.has(sessionId))) return false;
    return true;
  });
}

function dedupeSessions(sessions: ActiveAgentSession[]) {
  const deduped: ActiveAgentSession[] = [];
  for (const session of sessions) {
    const duplicate = deduped.find((candidate) =>
      candidate.agentKind === session.agentKind &&
      (candidate.project === session.project || candidate.project === "Workspace" || session.project === "Workspace") &&
      (
        comparableTitle(candidate.title) === comparableTitle(session.title) ||
        (candidate.project === "Workspace") !== (session.project === "Workspace") ||
        candidate.title === "Agent working" ||
        session.title === "Agent working"
      ) &&
      Math.abs(Date.parse(candidate.lastActivityAt) - Date.parse(session.lastActivityAt)) <= 2 * 60_000
    );
    if (!duplicate) {
      deduped.push(session);
      continue;
    }
    duplicate.sourceSessionIds = [...new Set([...duplicate.sourceSessionIds, ...session.sourceSessionIds])];
    if (duplicate.project === "Workspace" && session.project !== "Workspace") duplicate.project = session.project;
    duplicate.events = uniqueEvents([...duplicate.events, ...session.events]).slice(0, 5);
    duplicate.eventCount = Math.max(duplicate.eventCount, session.eventCount, duplicate.events.length);
    duplicate.durationSeconds = Math.max(duplicate.durationSeconds, session.durationSeconds);
  }
  return deduped;
}

function comparableTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueEvents(events: ActivityIslandEvent[]) {
  const seen = new Set<string>();
  return events
    .sort((left, right) => Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""))
    .filter((event) => {
      const key = [event.event_name, event.tool_name, cleanText(event.prompt), event.created_at].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function syntheticSession(agent: ActivityIslandSourceAgent): ActivityIslandSourceSession {
  return {
    id: `${agent.kind}:${agent.hostname ?? "local"}:${agent.project_path ?? "session"}`,
    title: agent.short_summary,
    summary: agent.short_summary,
    project_path: agent.project_path,
    last_activity_at: agent.activity_at,
    event_count: 1,
  };
}

function activeVisualState(event: ActivityIslandEvent | undefined, agent: ActivityIslandSourceAgent): ActiveAgentSession["visualState"] {
  const eventName = cleanText(event?.event_name ?? agent.event_name).toLowerCase();
  return cleanText(event?.tool_name ?? agent.tool_name) || /(?:pre|post)?tooluse|tool_call|command/.test(eventName)
    ? "running"
    : "processing";
}

function attentionMatchesSession(attention: AgentAttentionTarget | undefined, session: ActiveAgentSession) {
  if (!attention?.agentKind || attention.agentKind !== session.agentKind) return false;
  if (attention.sessionId && session.sourceSessionIds.includes(attention.sessionId)) return true;
  const attentionPath = normalizedPath(attention.projectPath);
  const sessionPath = normalizedPath(session.projectPath);
  return !attentionPath || !sessionPath || attentionPath === sessionPath;
}

function visualStatePriority(state: ActiveAgentSession["visualState"]) {
  if (state === "waiting") return 3;
  if (state === "running") return 2;
  return 1;
}

function normalizedPath(value?: string) {
  return String(value ?? "").replace(/[\\/]+$/, "").toLowerCase();
}

function isRecent(value: string, now: number, activeWithinMs: number) {
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now + 5_000 && now - at <= activeWithinMs;
}

function projectName(value?: string) {
  const normalized = String(value ?? "").replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).pop() || "Workspace";
}

function latestAction(event: ActivityIslandEvent | undefined, agent: ActivityIslandSourceAgent) {
  const tool = cleanText(event?.tool_name ?? agent.tool_name);
  if (tool) return friendlyToolAction(tool);
  const eventName = cleanText(event?.event_name ?? agent.event_name);
  if (eventName === "UserPromptSubmit") return "Reading your request";
  if (eventName === "SubagentStart") return "Started a subagent";
  if (eventName === "SubagentStop") return "Subagent finished";
  return eventName ? humanize(eventName) : "Working";
}

function friendlyToolAction(tool: string) {
  const normalized = tool.toLowerCase().replace(/[_-]+/g, " ");
  if (/^(read|cat|view|open)$/.test(normalized)) return "Reviewing project files";
  if (/^(write|edit|multiedit|apply patch)$/.test(normalized)) return "Updating a file";
  if (/^(bash|shell|terminal|command)$/.test(normalized)) return "Running a command";
  if (/^(grep|glob|search|find)$/.test(normalized)) return "Searching the project";
  if (/^(task|agent|subagent)$/.test(normalized)) return "Delegating work";
  return "Working with a project tool";
}

function friendlySummary(value: unknown) {
  return userFacingText(value)
    .replace(/\b(\d+) events?\b/gi, "$1 actions")
    .replace(/\b(\d+) approvals?\b/gi, "$1 approval requests")
    .replace(/\b(\d+) denied\b/gi, "$1 blocked");
}

function sanitizeEvent(event: ActivityIslandEvent): ActivityIslandEvent {
  const prompt = userFacingText(event.prompt);
  return { ...event, prompt: prompt || undefined };
}

function userFacingText(value: unknown) {
  if (typeof value !== "string") return "";
  const session = value.match(/<session(?:\s[^>]*)?>([\s\S]*?)<\/session>/i)?.[1];
  const candidate = (session ?? value).trim();
  if (isInternalControlText(candidate)) return "";
  return cleanText(candidate);
}

function isInternalControlText(value: string) {
  return /^(?:\[(?:suggestion|system|developer|assistant|tool)\s*(?:mode|message)?\s*:|<(?:system|system-reminder|developer|assistant|tool|command-name|command-message|local-command-(?:caveat|stdout|stderr)|ide_[a-z0-9_-]+)\b)/i.test(value) ||
    /^the user (?:has )?stepped away\b[\s\S]*\b(?:recap|summari[sz]e)\b/i.test(value) ||
    /^the user (?:is|will be) (?:coming back|returning)\b[\s\S]*\b(?:recap|summari[sz]e)\b/i.test(value) ||
    /^this session is being continued from a previous conversation\b/i.test(value) ||
    /^suggest what the user might naturally type next\b/i.test(value) ||
    /^you have \d+ weighted tokens left\b/i.test(value);
}

function isClaudeStatusPrompt(agent: ActivityIslandSourceAgent, event: ActivityIslandEvent) {
  if (agent.kind !== "claude-code" || cleanText(event.event_name) !== "UserPromptSubmit") return false;
  return /^\/?quota$/i.test(cleanText(event.prompt));
}

function humanize(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  const session = value.match(/<session(?:\s[^>]*)?>([\s\S]*?)<\/session>/i)?.[1];
  return (session ?? value)
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
import type { PluginIslandContribution } from "@openleash/shared";
