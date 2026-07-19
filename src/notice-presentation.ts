export function noticeIsCurrentlyPresented(input: {
  requestedKey: string;
  activeKey?: string;
  nativeVisible: boolean;
  browserVisible: boolean;
}) {
  return input.activeKey === input.requestedKey &&
    (input.nativeVisible || input.browserVisible);
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
