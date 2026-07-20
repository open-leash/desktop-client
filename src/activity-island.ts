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
  agentKind: string;
  agentName: string;
  project: string;
  title: string;
  summary: string;
  latestAction: string;
  lastActivityAt: string;
  durationSeconds: number;
  eventCount: number;
  events: ActivityIslandEvent[];
};

const TERMINAL_EVENTS = new Set(["sessionend", "stop", "completed", "agentstop"]);

export function activeAgentSessions(
  agents: ActivityIslandSourceAgent[],
  now = Date.now(),
  activeWithinMs = 2 * 60_000,
): ActiveAgentSession[] {
  return agents.flatMap((agent) => {
    const sessions = agent.sessions?.length ? agent.sessions : [syntheticSession(agent)];
    return sessions.flatMap((session, index) => {
      const lastActivityAt = session.last_activity_at ?? agent.activity_at;
      if (!lastActivityAt || !isRecent(lastActivityAt, now, activeWithinMs)) return [];
      const latestEvent = session.events?.[0];
      const eventName = latestEvent?.event_name ?? (index === 0 ? agent.event_name : undefined);
      if (eventName && TERMINAL_EVENTS.has(eventName.toLowerCase())) return [];
      const projectPath = session.project_path ?? agent.project_path;
      return [{
        id: session.id,
        sessionId: session.session_id ?? session.id,
        agentKind: agent.kind,
        agentName: agent.display_name,
        project: projectName(projectPath),
        title: cleanText(session.title) || cleanText(latestEvent?.prompt) || "Agent session",
        summary: cleanText(session.summary) || cleanText(agent.short_summary) || "Activity detected",
        latestAction: latestAction(latestEvent, agent),
        lastActivityAt,
        durationSeconds: Math.max(0, Number(session.duration_seconds ?? 0)),
        eventCount: Math.max(1, Number(session.event_count ?? session.events?.length ?? 1)),
        events: session.events?.slice(0, 5) ?? [],
      }];
    });
  }).sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt));
}

export function activityIslandKey(sessions: ActiveAgentSession[]) {
  return `activity:${sessions.map((session) => session.id).sort().join("|")}`;
}

export function contributionsForSession(
  contributions: PluginIslandContribution[],
  sessionId: string,
) {
  return contributions.filter((contribution) =>
    contribution.sessionId === sessionId || contribution.relatedSessionIds?.includes(sessionId)
  );
}

export function ambientIslandContributions(contributions: PluginIslandContribution[]) {
  return contributions.filter((contribution) => !contribution.sessionId);
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
  if (tool) return humanize(tool);
  const eventName = cleanText(event?.event_name ?? agent.event_name);
  if (eventName === "UserPromptSubmit") return "Reading your request";
  if (eventName === "SubagentStart") return "Started a subagent";
  if (eventName === "SubagentStop") return "Subagent finished";
  return eventName ? humanize(eventName) : "Working";
}

function humanize(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 180) : "";
}
import type { PluginIslandContribution } from "@openleash/shared";
