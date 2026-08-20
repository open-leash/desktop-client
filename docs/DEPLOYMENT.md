# Deployment

## Personal Open Source

```bash
python3 run.py --mode individual-open-source --clean-slate --yes
```

This starts Postgres, applies migrations, seeds the local personal account,
starts Leash Engine, and launches Desktop. Docker packages Postgres and may
package Engine; built-in Features themselves always run in the Node.js Engine
process and require no Feature images or containers.

Persistent data lives in the named Postgres volume. A clean-slate run removes
local Leash containers, volumes, client state, installed services, and hooks
before recreating the stack.

## Leash Cloud

Production clients use `https://api.openleash.com`. Hosted provisioning,
billing, abuse controls, credentials, and operational composition live outside
this public repository. The public repository ships no dashboard, identity
provider, marketing site, or Business control plane.

## Independent images and GCP builds

The monorepo does not produce one combined service image:

- Engine: `docker build -f apps/engine/Dockerfile .`
- Local proxy: `docker build apps/local-proxy`
- Provider sync worker: `docker build apps/provider-sync-worker`

Google Cloud Build uses one trigger per deployed service. Engine points at
`cloudbuild.engine.yaml`; the optional provider worker points at
`cloudbuild.provider-sync-worker.yaml`. Private `main-web` and
`cloud-client-api` continue using the build configurations in their own private
repositories. GitHub workflows publish Engine and local-proxy compatibility
images to GHCR for Personal Open Source installations.
