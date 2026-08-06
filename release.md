# Leash release system

A Leash release is complete only when the personal product, built-in Features, installers, update feed, and public documentation agree on the same version and behavior.

## Mandatory gates

1. Public-boundary, user-flow, and deployment-readiness audits pass.
2. Shared, client API, desktop, website, docs, flow viewer, provider puller, and mobile checks pass where their toolchains are available.
3. Every registered Feature has a reviewed in-process handler and representative allow, ask, block, transform, or observe fixtures.
4. A clean Personal Open Source install starts Postgres, runs migrations, bootstraps one user, verifies Features, installs selected agent hooks, configures the proxy, and produces flow events.
5. Retired dashboard, organization, SSO, marketplace, upload, and container-Feature surfaces remain unavailable.
6. macOS and Windows artifacts are built from the same tagged desktop version. SHA-256 manifests match the uploaded bytes.
7. The website links to those exact artifacts and the update API returns the verified platform-specific release.
8. Changed repositories are committed and pushed, the parent repository records their commits, and published tags/releases are not drafts.

## Versioning and artifacts

Use stable semantic versions. Desktop artifacts are named `Leash-VERSION-arm64.dmg` and `Leash-VERSION-x64-Setup.exe`. Compatibility identifiers such as the `openleash-personal` update app ID and `OPENLEASH_*` environment variables remain stable.

## Release command

```bash
python3 release.py --all-changed --ship
```

Review the generated release plan before publishing. Never bypass a failing gate merely to create a tag.
