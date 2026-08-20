import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

type ConnectionDraft = {
  clientMode: string;
  remoteApiUrl: string;
};

type ConnectionState = Partial<ConnectionDraft> & {
  cloudApiUrl?: string;
};

const windowHtml = readFileSync(join(__dirname, "window.html"), "utf8");
const helperSource = windowHtml.match(
  /\/\* setup-connection-draft:start \*\/([\s\S]*?)\/\* setup-connection-draft:end \*\//,
)?.[1];

assert.ok(helperSource, "setup connection draft helper is present");

const mergeSetupConnectionDraft = new Function(
  `${helperSource}; return mergeSetupConnectionDraft;`,
)() as (
  current: ConnectionDraft,
  incoming: ConnectionState,
  setupLocked: boolean,
  connectionTouched: boolean,
) => ConnectionDraft;

test("a background cloud update does not reset an in-progress open-source selection", () => {
  const draft = mergeSetupConnectionDraft(
    { clientMode: "custom", remoteApiUrl: "http://127.0.0.1:9318" },
    {
      clientMode: "cloud",
      remoteApiUrl: "https://api.openleash.com",
      cloudApiUrl: "https://api.openleash.com",
    },
    true,
    true,
  );

  assert.deepEqual(draft, {
    clientMode: "custom",
    remoteApiUrl: "http://127.0.0.1:9318",
  });
});

test("an untouched setup draft still initializes from persisted state", () => {
  const draft = mergeSetupConnectionDraft(
    { clientMode: "cloud", remoteApiUrl: "https://api.openleash.com" },
    {
      clientMode: "custom",
      remoteApiUrl: "http://127.0.0.1:9318",
    },
    true,
    false,
  );

  assert.deepEqual(draft, {
    clientMode: "custom",
    remoteApiUrl: "http://127.0.0.1:9318",
  });
});

test("completed setup follows persisted connection changes", () => {
  const draft = mergeSetupConnectionDraft(
    { clientMode: "custom", remoteApiUrl: "http://127.0.0.1:9318" },
    {
      clientMode: "cloud",
      remoteApiUrl: "https://api.openleash.com",
    },
    false,
    true,
  );

  assert.deepEqual(draft, {
    clientMode: "cloud",
    remoteApiUrl: "https://api.openleash.com",
  });
});
