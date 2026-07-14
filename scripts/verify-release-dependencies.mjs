#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile(new URL("../src/proxy-manager.ts", import.meta.url), "utf8");
const match = source.match(/DEFAULT_LOCAL_PROXY_IMAGE\s*=\s*\n?\s*["']([^"']+)["']/);
assert(match, "Could not find DEFAULT_LOCAL_PROXY_IMAGE in proxy-manager.ts");

const image = match[1];
assert(!image.endsWith(":latest"), `Desktop proxy image must be immutable, received ${image}`);

const parsed = /^ghcr\.io\/([^/]+)\/([^:@]+):([^@]+)$/.exec(image);
assert(parsed, `Expected a versioned GHCR image, received ${image}`);
const [, owner, repository, tag] = parsed;
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
  `https://ghcr.io/v2/${owner}/${repository}/manifests/${tag}`,
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
  `[desktop-release] verified anonymous proxy image ${image} (${[...platforms].sort().join(", ")})`,
);
