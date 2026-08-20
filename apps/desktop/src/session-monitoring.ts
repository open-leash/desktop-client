export const SESSION_MONITORING_PAUSE_MS = 30 * 60_000;

export type SessionMonitoringPause = {
  agentKind: string;
  sessionIds: string[];
  expiresAt: number;
};

export function pausableSessionIds(values: unknown[]) {
  return [...new Set(values
    .map((value) => String(value ?? "").trim())
    .filter((value) =>
      value.length > 0 &&
      value.length <= 512 &&
      !["proxy", "unknown"].includes(value.toLowerCase())
    ))].slice(0, 16);
}

export class SessionMonitoringPauses {
  private readonly byKey = new Map<string, SessionMonitoringPause>();

  pause(
    agentKindValue: string,
    sessionIdValues: unknown[],
    durationMs = SESSION_MONITORING_PAUSE_MS,
    now = Date.now(),
  ) {
    const agentKind = normalizeAgentKind(agentKindValue);
    const sessionIds = pausableSessionIds(sessionIdValues);
    if (!agentKind || sessionIds.length === 0) return undefined;
    const expiresAt = now + Math.max(1_000, Math.min(durationMs, SESSION_MONITORING_PAUSE_MS));
    const pause = { agentKind, sessionIds, expiresAt };
    for (const sessionId of sessionIds) this.byKey.set(key(agentKind, sessionId), pause);
    return pause;
  }

  resume(agentKindValue: string, sessionIdValues: unknown[]) {
    const agentKind = normalizeAgentKind(agentKindValue);
    const pauses = new Set(
      pausableSessionIds(sessionIdValues)
        .map((sessionId) => this.byKey.get(key(agentKind, sessionId)))
        .filter((pause): pause is SessionMonitoringPause => Boolean(pause)),
    );
    for (const pause of pauses) {
      for (const sessionId of pause.sessionIds)
        this.byKey.delete(key(pause.agentKind, sessionId));
    }
    return pauses.size > 0;
  }

  active(agentKindValue: string, sessionIdValue: unknown, now = Date.now()) {
    const agentKind = normalizeAgentKind(agentKindValue);
    const sessionId = String(sessionIdValue ?? "").trim();
    if (!agentKind || !sessionId) return undefined;
    const pause = this.byKey.get(key(agentKind, sessionId));
    if (!pause) return undefined;
    if (pause.expiresAt <= now) {
      this.resume(pause.agentKind, pause.sessionIds);
      return undefined;
    }
    return pause;
  }

  replace(pauses: SessionMonitoringPause[], now = Date.now()) {
    this.byKey.clear();
    for (const pause of pauses) {
      const durationMs = pause.expiresAt - now;
      if (durationMs <= 0) continue;
      this.pause(pause.agentKind, pause.sessionIds, durationMs, now);
    }
  }
}

function normalizeAgentKind(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function key(agentKind: string, sessionId: string) {
  return `${agentKind}\u0000${sessionId}`;
}
