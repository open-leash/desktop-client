# Deployment

## Personal Open Source

```bash
python3 run.py --mode individual-open-source --clean-slate --yes
```

This starts Postgres, applies migrations, seeds the local personal account, starts the real `client-api`, and launches the desktop client. Docker must be running because Postgres and the backend are containerized. Features run inside the Node.js API process and require no Feature images or containers.

Persistent data lives in the named Postgres volume. A clean-slate run removes local Leash containers, volumes, client state, and installed hooks before recreating the stack.

## Leash Cloud

Production clients use `https://api.openleash.com`. Hosted provisioning, billing, abuse controls, credentials, and operational composition live outside this public repository. The public repo does not ship a dashboard or identity-provider service.

## Images

The public image publisher builds `client-api`, `local-proxy`, and `provider-puller`, with `main-web` and `docs-web` optional. It does not build dashboard or Feature images.
