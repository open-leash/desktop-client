# OpenLeash release 2026-08-02 status

## Published and verified

- `client-api` `v0.36.37` (`89ea682f48784c2d888103560babb8204bb04ab6`)
  - `ghcr.io/open-leash/client-api:0.36.37`
  - digest: `sha256:05533ce54b77d6fd223d2f2a85132f55dca80f6dab899a05427a623defe16f95`
  - Linux amd64/arm64, provenance and SBOM published, anonymous pull verified, and zero HIGH/CRITICAL Trivy findings.
  - The immutable image passed live Individual Open Source and Private Cloud API health checks against Postgres.
- `dashboard-web` `v0.1.9` (`3000f18feaca1894175508c5f714c4e95f5c37ab`)
  - `ghcr.io/open-leash/dashboard-web:0.1.9`
  - digest: `sha256:c95828ba87e3f0bacc165085288810356878dd648e82eb725b3c1e2c42bf1783`
  - Linux amd64/arm64, provenance and SBOM published, anonymous pull verified, and zero HIGH/CRITICAL Trivy findings.
  - The immutable image passed a live HTTP smoke test against the released Private Cloud API image.
- Managed production builds and deployments completed successfully for `cloud-client-api` `v0.1.10`, `cloud-dashboard-api` `v0.1.5`, and `cloud-dashboard-web` `v0.1.4`. `api.openleash.com/health` and `dashboard.openleash.com` return HTTP 200, and an unauthenticated hook smoke request is rejected with HTTP 401.
- `main-web` `v0.1.44` was built and deployed after `v0.1.43` briefly pointed the installer at the unsigned desktop draft. The live installer is restored to signed desktop `v0.36.49`; its public release API, installer helper, arm64 DMG, checksum asset, and ranged DMG download were verified.

## Prepared but not promoted

- `desktop-client` `v0.36.52` is tagged and its GitHub release remains a draft. The macOS and Windows release jobs stopped before artifact publication because the repositories do not have the required signing/notarization secrets. No unsigned artifact was substituted and no stable update record was changed.
- Production is managed by Cloud Build in project `cloud-497307`, while the available local Google Cloud account has no access to that project and no approved production database URL. The successful managed build/deploy checks and live endpoint checks are recorded, but the Artifact Registry digests and production migration ledger could not be independently inspected from this environment. No manual migration was attempted against an unverified database target.

## Rollback

- Public self-hosted operators can retain the previous pinned image digests; the new images are immutable and were not published as `latest`.
- If hosted health regresses, roll each managed service back to its previous successful Cloud Run revision through the production project before changing database state.
- Keep the desktop release in draft until signed assets pass notarization, checksums, packaged ABI checks, and update-feed verification.
