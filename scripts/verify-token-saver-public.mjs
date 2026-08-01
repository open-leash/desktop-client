#!/usr/bin/env node
import fs from "node:fs";

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const manifest = fs.readFileSync("packages/shared/src/index.ts", "utf8");
const version = valueAfter("--version") ?? JSON.parse(fs.readFileSync("plugins/plugin-token-saver/package.json", "utf8")).version;
const expectedDigest = valueAfter("--digest") ?? manifest.match(/id: "openleash\.prompt-compression"[\s\S]*?digest: "(sha256:[a-f0-9]{64})"/)?.[1];
const scope = "repository:open-leash/plugin-token-saver:pull";
const tokenResponse = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`);
if (!tokenResponse.ok) {
  throw new Error(`Token Saver is not anonymously pullable from GHCR (token HTTP ${tokenResponse.status}). Set the package visibility to Public.`);
}
const token = (await tokenResponse.json()).token;
if (!token) throw new Error("GHCR returned no anonymous pull token for Token Saver");
const response = await fetch(`https://ghcr.io/v2/open-leash/plugin-token-saver/manifests/${encodeURIComponent(version)}`, {
  headers: {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
  },
});
if (!response.ok) throw new Error(`Anonymous Token Saver manifest pull failed with HTTP ${response.status}`);
const digest = response.headers.get("docker-content-digest");
if (expectedDigest && digest !== expectedDigest) {
  throw new Error(`Public Token Saver digest ${digest} differs from release digest ${expectedDigest}`);
}
console.log(`Token Saver ${version} is publicly pullable at ${digest}.`);
