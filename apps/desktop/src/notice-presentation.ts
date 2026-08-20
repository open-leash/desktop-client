export function noticeIsCurrentlyPresented(input: {
  requestedKey: string;
  activeKey?: string;
  nativeVisible: boolean;
  browserVisible: boolean;
}) {
  return input.activeKey === input.requestedKey &&
    (input.nativeVisible || input.browserVisible);
}

export function approvalPresentationKey(intentKey: string, decisionId: string) {
  return `ask:${intentKey || decisionId}`;
}

export function activityPresentationKey(input: {
  activityKey: string;
  pluginActivity: string;
  pendingKey?: string;
}) {
  return input.pendingKey
    ? `activity:attention:${input.pendingKey}`
    : `${input.activityKey}:${input.pluginActivity}:attention:idle`;
}

export function preferPreviouslyPresentedPending<T extends { id: string }>(
  items: T[],
  previous: T[],
  keyFor: (item: T) => string,
) {
  const preferredIds = new Map(previous.map((item) => [keyFor(item), item.id]));
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) =>
    group.find((item) => item.id === preferredIds.get(key)) ?? group[0]
  );
}

export function matchingPendingSourceIds<T extends { id: string }>(
  selected: T | undefined,
  sources: T[],
  keyFor: (item: T) => string,
  fallbackId: string,
) {
  if (!selected) return [fallbackId];
  const key = keyFor(selected);
  const matches = sources.filter((item) => keyFor(item) === key).map((item) => item.id);
  return [...new Set(matches.length > 0 ? matches : [fallbackId])];
}

export class AutomaticNoticeRegistry {
  private readonly presented = new Map<string, number>();

  constructor(
    private readonly ttlMs = Number.POSITIVE_INFINITY,
    private readonly maxEntries = 2_000,
  ) {}

  shouldPresent(key: string, now = Date.now()) {
    this.prune(now);
    if (this.presented.has(key)) return false;
    this.presented.set(key, now);
    this.trim();
    return true;
  }

  private prune(now: number) {
    for (const [key, presentedAt] of this.presented) {
      if (now - presentedAt >= this.ttlMs) this.presented.delete(key);
    }
  }

  private trim() {
    while (this.presented.size > this.maxEntries) {
      const oldest = this.presented.keys().next().value as string | undefined;
      if (!oldest) return;
      this.presented.delete(oldest);
    }
  }
}
