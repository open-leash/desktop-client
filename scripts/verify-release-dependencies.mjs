#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const proxySource = await fs.readFile(new URL("../src/proxy-manager.ts", import.meta.url), "utf8");
const proxyMatch = proxySource.match(/DEFAULT_LOCAL_PROXY_IMAGE\s*=\s*\n?\s*["']([^"']+)["']/);
assert(proxyMatch, "Could not find DEFAULT_LOCAL_PROXY_IMAGE in proxy-manager.ts");
const mainSource = await fs.readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const clientApiMatches = [...mainSource.matchAll(/client-api:\\\$\{OPENLEASH_VERSION:-([^}]+)\}/g)]
  .map((match) => `ghcr.io/open-leash/client-api:${match[1]}`);
assert(clientApiMatches.length > 0, "Could not find the embedded client-api image in main.ts");
assert.equal(new Set(clientApiMatches).size, 1, "Embedded client-api image pins must be identical");

const installerUrl = process.env.OPENLEASH_PERSONAL_INSTALLER
  ? new URL(`file://${process.env.OPENLEASH_PERSONAL_INSTALLER}`)
  : new URL("../../../scripts/install-openleash-personal.sh", import.meta.url);
try {
  const installerSource = await fs.readFile(installerUrl, "utf8");
  const installerMatch = installerSource.match(
    /OPENLEASH_VERSION="\$\{OPENLEASH_VERSION:-([^}]+)\}"/,
  );
  assert(installerMatch, "Could not find the installer client-api default");
  assert.equal(
    `ghcr.io/open-leash/client-api:${installerMatch[1]}`,
    clientApiMatches[0],
    "Personal installer and desktop client-api image pins must be identical",
  );
} catch (error) {
  if (error?.code !== "ENOENT" || process.env.OPENLEASH_PERSONAL_INSTALLER) {
    throw error;
  }
}

for (const image of [proxyMatch[1], clientApiMatches[0]]) {
  await verifyPublishedImage(image);
}

async function verifyPublishedImage(image) {
  assert(!image.endsWith(":latest"), `Desktop dependency image must be immutable, received ${image}`);

  const parsed = /^ghcr\.io\/([^/]+)\/([^:@]+):([^@]+)@(sha256:[a-f0-9]{64})$/.exec(image);
  assert(parsed, `Expected a versioned, digest-pinned GHCR image, received ${image}`);
  const [, owner, repository, tag, digest] = parsed;
  const scope = `repository:${owner}/${repository}:pull`;

// Deliberately request an anonymous registry token. Using the release runner's
// Docker login would let a private package pass while every clean install fails.
  const tokenResponse = await fetch(
    `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`,
  );
  assert(tokenResponse.ok, `GHCR did not issue an anonymous pull token for ${image}`);
  const { token } = await tokenResponse.json();
  assert(token, `GHCR anonymous token response was empty for ${image}`);

  const manifestResponse = await fetch(
    `https://ghcr.io/v2/${owner}/${repository}/manifests/${digest}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: [
          "application/vnd.oci.image.index.v1+json",
          "application/vnd.docker.distribution.manifest.list.v2+json",
          "application/vnd.oci.image.manifest.v1+json",
        ].join(", "),
      },
    },
  );
  assert(
    manifestResponse.ok,
    `${image} is not anonymously pullable (GHCR returned ${manifestResponse.status})`,
  );

  const manifest = await manifestResponse.json();
  const platforms = new Set(
    (manifest.manifests ?? [])
      .map((entry) => `${entry.platform?.os}/${entry.platform?.architecture}`)
      .filter((platform) => !platform.endsWith("/unknown")),
  );
  for (const required of ["linux/amd64", "linux/arm64"]) {
    assert(platforms.has(required), `${image} is missing required platform ${required}`);
  }

  console.log(
    `[desktop-release] verified anonymous image ${image} (${[...platforms].sort().join(", ")})`,
  );
}
