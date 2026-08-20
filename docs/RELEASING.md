# Releases

The public runtime is versioned from `open-leash/leash`. Public components keep
independent package/image versions, but their source, tests, and release
workflows live in one repository.

## Local release gates

```bash
npm ci
npm run audit:public
npm run typecheck
npm run build
npm run test:upgrade
npm run test:runner
npm run test:deployment:public
npm run smoke:product:public
```

On macOS, `npm run dist:personal` additionally builds the native proxy, runs
the Island verification, rebuilds native Node dependencies for Electron, and
creates the current Desktop artifact.

## Public artifacts

- Desktop tags use `vX.Y.Z`; the root macOS and Windows workflows attach the
  native artifacts, update metadata, and checksums to the same GitHub release.
- Engine container tags use `engine-vX.Y.Z` and publish the compatibility image
  `ghcr.io/open-leash/client-api:X.Y.Z`.
- Local-proxy tags use `local-proxy-vX.Y.Z` and publish
  `ghcr.io/open-leash/local-proxy:X.Y.Z`.
- Shared, Mobile, provider worker, and flow viewer release from the same commit
  and use component-prefixed tags where a standalone artifact is required.

Image and route compatibility names are deliberately retained so existing
Personal Open Source installations continue to upgrade.

## Private deployments

`main-web`, `cloud-client-api`, and the Business dashboard/control plane remain
separate private repositories. Their GCP triggers build only those services and
pin a tested public `open-leash/leash` commit or released artifact. The docs site
also remains a separate public repository and has its own deployment.

The production conductor remains available through:

```bash
python3 release.py --production --app desktop-client=X.Y.Z --dry-run --yes
```

Always run a dry plan first. Live releases require a clean `main` checkout,
append-only migrations, explicit versions, GitHub/GCP authentication, and all
component gates. Release journals under `~/.openleash-release/` are resumable;
secrets and database credentials are never written to them.
