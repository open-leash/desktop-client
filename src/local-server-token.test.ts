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

    server.resetAllLocalState();
    assert.equal(server.token, configuredToken);
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousToken === undefined) delete process.env.OPENLEASH_DEV_TOKEN;
    else process.env.OPENLEASH_DEV_TOKEN = previousToken;
  }
});
