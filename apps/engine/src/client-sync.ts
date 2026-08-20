import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OpenLeashClientSyncEvent } from "@openleash/shared";

type DatabaseSyncPayload = OpenLeashClientSyncEvent & {
  userId: string;
  organizationId?: string;
};

type Subscriber = {
  userId: string;
  send: (event: OpenLeashClientSyncEvent) => void;
};

const CHANNEL = "openleash_client_sync";

export class ClientSyncBroker {
  private listener?: PoolClient;
  private starting?: Promise<void>;
  private retryTimer?: NodeJS.Timeout;
  private subscribers = new Map<string, Subscriber>();

  constructor(private readonly pool: Pool) {}

  async subscribe(
    scope: { userId: string },
    send: Subscriber["send"],
  ) {
    await this.ensureListening();
    const id = crypto.randomUUID();
    this.subscribers.set(id, { ...scope, send });
    return () => {
      this.subscribers.delete(id);
    };
  }

  dispatch(payload: DatabaseSyncPayload) {
    const event: OpenLeashClientSyncEvent = {
      schemaVersion: "2026-07-27.client-sync.v1",
      id: payload.id,
      kind: payload.kind,
      occurredAt: payload.occurredAt,
    };
    for (const subscriber of this.subscribers.values()) {
      // Client streams are personal. Organization-wide supervision has a
      // separate authorization model and must never fan another user's
      // interaction metadata out to a personal desktop or phone.
      if (subscriber.userId !== payload.userId) continue;
      subscriber.send(event);
    }
  }

  private async ensureListening() {
    if (this.listener) return;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start() {
    const listener = await this.pool.connect();
    this.listener = listener;
    listener.on("notification", (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      try {
        const payload = JSON.parse(message.payload) as DatabaseSyncPayload;
        if (
          payload.schemaVersion === "2026-07-27.client-sync.v1" &&
          payload.userId &&
          payload.id
        ) {
          this.dispatch(payload);
        }
      } catch {
        // Ignore malformed database notifications. The periodic client refresh
        // remains the recovery path.
      }
    });
    listener.on("error", () => this.reconnect(listener));
    await listener.query(`listen ${CHANNEL}`);
  }

  private reconnect(failed: PoolClient) {
    if (this.listener !== failed) return;
    this.listener = undefined;
    failed.release(true);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.subscribers.size > 0) {
        void this.ensureListening().catch(() => this.reconnectLater());
      }
    }, 1000);
  }

  private reconnectLater() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.subscribers.size > 0) {
        void this.ensureListening().catch(() => this.reconnectLater());
      }
    }, 2000);
  }
}
