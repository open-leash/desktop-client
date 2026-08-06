# Leash Architecture

## Public product

The public product is personal-only:

```text
desktop / mobile / web
          |
       client-api
          |
       Postgres
          |
  built-in Features (in process)
```

`desktop-client` installs agent hooks, manages the local proxy, renders the island, and talks to `client-api`. `mobile-client` handles personal approvals. `client-api` is the source of truth for sessions, decisions, Feature settings, audit records, releases, and personal auth.

Personal Open Source runs `client-api` and Postgres locally. Leash Cloud composes hosted providers around the same public client API. Public code contains no dashboard, dashboard API, organization management, customer identity-provider loader, or public marketplace.

## Feature execution

Features are registered in `apps/client-api/src/plugins/feature-runtime.ts`. Each manifest declares `runtime: "builtin"`, `execution.type: "in-process"`, and a reviewed handler. The API calls the handler directly and provides bounded capabilities for evaluation, audit, notification, state, and network access.

Compatibility identifiers retain the `openleash.*` namespace. Existing `/v1/plugins` and `/v1/plugin-runtime/*` routes remain where clients depend on them, but they operate on first-party Features and never launch Feature containers.

## Data and transport

Postgres remains required for both modes. Agent hooks call the configured client API. The local proxy covers provider traffic that hook APIs cannot see, while normalized event fingerprints deduplicate hook and proxy copies.
