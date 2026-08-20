# Leash

Leash is the open-source control layer for personal AI agents. It observes agent activity, asks for approval before risky actions, masks sensitive data, enforces selected project instructions, and records understandable outcomes.

## Product modes

- **Leash Cloud**: a personal hosted account used from desktop, mobile, and web.
- **Personal Open Source**: Leash Engine and Postgres running locally, without a Leash Cloud account.

There is no public organization dashboard, dashboard API, identity-provider service, or team-management product in this repository.

## Built-in Features

Security and productivity capabilities ship as first-party **Features**. They execute as reviewed TypeScript handlers inside Leash Engine; they do not use per-Feature containers or a public marketplace. Stable `@openleash/client-api`, `OPENLEASH_*`, `openleash.*`, image, and `/v1/plugins` identifiers remain compatibility contracts.

## One public repository

The public runtime is developed and released together:

| Path | Purpose |
| --- | --- |
| `apps/engine` | Personal event API, decisions, approvals, Features, and Postgres migrations |
| `apps/desktop` | macOS and Windows client, tray, Island, hooks, and local proxy management |
| `apps/mobile` | Optional personal iOS and Android companion |
| `apps/local-proxy` | Native provider-traffic enforcement edge |
| `apps/provider-sync-worker` | Optional scheduler for provider-hosted activity |
| `apps/flow-viewer` | Local developer trace viewer |
| `packages/shared` | Versioned contracts shared by the runtime and clients |

The public documentation site remains in its own repository. The marketing site and all Business Cloud control-plane services are private and deploy independently; they consume this public core but are not copied into it.

Google Cloud Build should create one trigger per deployable service, all pointed
at this repository. Engine uses `cloudbuild.engine.yaml`; the optional provider
worker uses `cloudbuild.provider-sync-worker.yaml`. Private `main-web` and
`cloud-client-api` keep their own repositories and build configurations. A
monorepo is a source boundary, not a combined production image.

## Development

```bash
npm install
npm run dev:mode:individual-open-source
```

Docker is required for the local Postgres/API stack. It is not used to sandbox Features.

Useful gates:

```bash
npm run typecheck
npm test -w @openleash/client-api
npm test -w @openleash/desktop-client
npm run test:deployment
```

The npm package names above are retained for installed-client compatibility. New paths and product language use **Engine**, **Desktop**, and **Mobile**.

See [Product](docs/Product.md), [user flows](docs/USER_FLOWS.md), [architecture](docs/ARCHITECTURE.md), and [deployment](docs/DEPLOYMENT.md).
