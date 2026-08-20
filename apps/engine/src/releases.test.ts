import assert from "node:assert/strict";
import test from "node:test";
import {
  checkForClientUpdate,
  clientUpdatesEnabled,
  resetGithubReleaseCacheForTests,
} from "./releases.js";

test("client update checks default to enabled", () => {
  assert.equal(clientUpdatesEnabled(undefined), true);
  assert.equal(clientUpdatesEnabled("true"), true);
});

test("client update checks can fail closed", async () => {
  const previous = process.env.OPENLEASH_CLIENT_UPDATES_ENABLED;
  process.env.OPENLEASH_CLIENT_UPDATES_ENABLED = "false";
  try {
    const response = await checkForClientUpdate({
      app: "openleash-personal",
      version: "0.36.39",
      platform: "darwin",
      arch: "arm64",
      channel: "stable",
      installMode: "cloud",
      updateSource: "test",
    });
    assert.deepEqual(response, {
      updateAvailable: false,
      latestVersion: "0.36.39",
      currentVersion: "0.36.39",
      channel: "stable",
      platform: "darwin",
      arch: "arm64",
    });
  } finally {
    if (previous === undefined) delete process.env.OPENLEASH_CLIENT_UPDATES_ENABLED;
    else process.env.OPENLEASH_CLIENT_UPDATES_ENABLED = previous;
  }
});

test("recognized false values disable client update checks", () => {
  for (const value of ["0", "false", "FALSE", "off", "OFF"])
    assert.equal(clientUpdatesEnabled(value), false);
});

test("latest GitHub release serves the matching Mac installer", async () => {
  await withGithubRelease(async () => {
    const response = await checkForClientUpdate(updateRequest("darwin", "arm64"));
    assert.equal(response.updateAvailable, true);
    assert.equal(response.latestVersion, "0.37.2");
    assert.equal(
      response.downloadUrl,
      "https://downloads.example/Leash-0.37.2-arm64.dmg",
    );
    assert.equal(response.sha256, "a".repeat(64));
  });
});

test("latest GitHub release serves the matching Windows installer", async () => {
  await withGithubRelease(async () => {
    const response = await checkForClientUpdate(updateRequest("win32", "x64"));
    assert.equal(response.updateAvailable, true);
    assert.equal(response.latestVersion, "0.37.2");
    assert.equal(
      response.downloadUrl,
      "https://downloads.example/Leash-0.37.2-x64-Setup.exe",
    );
    assert.equal(response.sha256, "b".repeat(64));
  });
});

test("current desktop version does not receive an update prompt", async () => {
  await withGithubRelease(async () => {
    const response = await checkForClientUpdate({
      ...updateRequest("darwin", "arm64"),
      version: "0.37.2",
    });
    assert.equal(response.updateAvailable, false);
    assert.equal(response.latestVersion, "0.37.2");
  });
});

test("an unverified GitHub desktop artifact is never offered as an update", async () => {
  await withGithubRelease(async () => {
    const response = await checkForClientUpdate(updateRequest("darwin", "arm64"));
    assert.equal(response.updateAvailable, false);
    assert.equal(response.downloadUrl, undefined);
  }, { verified: false });
});

function updateRequest(platform: string, arch: string) {
  return {
    app: "openleash-personal",
    version: "0.37.1",
    platform,
    arch,
    channel: "stable",
    installMode: "cloud",
    updateSource: "test",
  };
}

async function withGithubRelease(
  run: () => Promise<void>,
  options: { verified?: boolean } = {},
) {
  const previousFetch = globalThis.fetch;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousReleaseDatabaseUrl = process.env.OPENLEASH_RELEASE_DATABASE_URL;
  resetGithubReleaseCacheForTests();
  delete process.env.DATABASE_URL;
  delete process.env.OPENLEASH_RELEASE_DATABASE_URL;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        tag_name: "v0.37.2",
        html_url: "https://github.com/open-leash/leash/releases/tag/v0.37.2",
        body: "A safer desktop release.",
        draft: false,
        prerelease: false,
        published_at: "2026-08-13T09:10:40Z",
        assets: [
          {
            name: "Leash-0.37.2-arm64.dmg",
            browser_download_url: "https://downloads.example/Leash-0.37.2-arm64.dmg",
            digest: `sha256:${"a".repeat(64)}`,
            size: 140_708_648,
          },
          {
            name: "Leash-0.37.2-x64-Setup.exe",
            browser_download_url: "https://downloads.example/Leash-0.37.2-x64-Setup.exe",
            digest: `sha256:${"b".repeat(64)}`,
            size: 115_550_425,
          },
          ...(options.verified === false ? [] : [
            { name: "MACOS-NOTARIZATION-VERIFIED", size: 1 },
            { name: "WINDOWS-SIGNATURE-VERIFIED", size: 1 },
          ]),
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    resetGithubReleaseCacheForTests();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousReleaseDatabaseUrl === undefined)
      delete process.env.OPENLEASH_RELEASE_DATABASE_URL;
    else process.env.OPENLEASH_RELEASE_DATABASE_URL = previousReleaseDatabaseUrl;
  }
}
