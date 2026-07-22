import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalOpenLeashServer } from "./local-server";

test("the configured local service token survives setup and install resets", async () => {
  const previousToken = process.env.OPENLEASH_DEV_TOKEN;
  const configuredToken = "openleash-local-token-test";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openleash-local-token-"));
  process.env.OPENLEASH_DEV_TOKEN = configuredToken;

  const server = new LocalOpenLeashServer(dataDir, { apiPort: 0, legacyAuthPort: 0 });
  try {
    assert.equal(server.token, configuredToken);

    server.resetSetup();
    assert.equal(server.token, configuredToken);

    assert.equal(server.islandActivityOnly, false, "the Island should stay visible by default");
    server.updateSettings("openai", undefined, undefined, true);
    assert.equal(server.islandActivityOnly, true);
    server.resetSetup();
    assert.equal(server.islandActivityOnly, true, "setup reset should preserve the Island visibility preference");

    server.resetAllLocalState();
    assert.equal(server.token, configuredToken);
    assert.equal(server.islandActivityOnly, false, "a full settings reset should restore always-on Island visibility");
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousToken === undefined) delete process.env.OPENLEASH_DEV_TOKEN;
    else process.env.OPENLEASH_DEV_TOKEN = previousToken;
  }
});
