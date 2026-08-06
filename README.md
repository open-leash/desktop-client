# Leash

Leash is a personal control layer for AI coding agents. It observes agent activity, asks for approval before risky actions, masks sensitive data, enforces selected project instructions, and records understandable outcomes.

## Product modes

- **Leash Cloud**: a personal hosted account used from desktop, mobile, and web.
- **Personal Open Source**: the real `client-api` and Postgres running locally, without a Leash Cloud account.

There is no public organization dashboard, dashboard API, identity-provider service, or team-management product in this repository.

## Built-in Features

Security and productivity capabilities ship as first-party **Features**. They execute as reviewed TypeScript handlers inside `client-api`; they do not use per-Feature containers or a public marketplace. Stable `openleash.*` IDs and `/v1/plugins` routes remain compatibility contracts.

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

See [Product](docs/Product.md), [user flows](docs/USER_FLOWS.md), [architecture](docs/ARCHITECTURE.md), and [deployment](docs/DEPLOYMENT.md).
