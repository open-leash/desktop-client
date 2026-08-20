import assert from "node:assert/strict";
import test from "node:test";
import { ClientSyncBroker } from "./client-sync.js";

test("client sync only reaches the owning user", () => {
  const broker = new ClientSyncBroker({} as never);
  const userEvents: string[] = [];
  const organizationEvents: string[] = [];
  const unrelatedEvents: string[] = [];
  (
    broker as unknown as {
      subscribers: Map<
        string,
        {
          userId: string;
          send: (event: { id: string }) => void;
        }
      >;
    }
  ).subscribers = new Map([
    [
      "user",
      {
        userId: "user-1",
        send: (event) => userEvents.push(event.id),
      },
    ],
    [
      "organization",
      {
        userId: "admin",
        send: (event) => organizationEvents.push(event.id),
      },
    ],
    [
      "unrelated",
      {
        userId: "user-2",
        send: (event) => unrelatedEvents.push(event.id),
      },
    ],
  ]);

  broker.dispatch({
    schemaVersion: "2026-07-27.client-sync.v1",
    id: "decision-1",
    kind: "interaction.created",
    occurredAt: "2026-07-27T10:00:00.000Z",
    userId: "user-1",
    organizationId: "org-1",
  });

  assert.deepEqual(userEvents, ["decision-1"]);
  assert.deepEqual(organizationEvents, []);
  assert.deepEqual(unrelatedEvents, []);
});
