# Leash Architecture

## Public runtime monorepo

```text
Leash Desktop / Mobile / personal web client
                       |
                  Leash Engine
                       |
                    Postgres
                       |
             built-in Features (in process)

agent hooks ─┐
local proxy ─┼── normalized events ──► Engine
provider sync worker ─┘
```

`apps/desktop` installs agent hooks, manages the native local proxy, renders the
Island, and talks to Engine. `apps/mobile` handles personal approvals.
`apps/engine` is the source of truth for sessions, decisions, Feature settings,
audit records, releases, and personal authentication. `packages/shared` holds
the versioned contract used by all of them.

Personal Open Source runs Engine and Postgres locally. Leash Cloud composes
hosted providers around the same public Engine API. Public code contains no
dashboard, dashboard API, organization management, customer identity-provider
loader, marketing site, or public marketplace.

The public docs site is a separate repository. Private `main-web`,
`cloud-client-api`, and Business control-plane repositories build and deploy
independently. They may depend on the public monorepo; the public monorepo never
imports them.

## Feature execution

Features are registered in `apps/engine/src/plugins/feature-runtime.ts`. Each
manifest declares `runtime: "builtin"`, `execution.type: "in-process"`, and a
reviewed handler. Engine calls the handler directly and provides bounded
capabilities for evaluation, audit, notification, state, and network access.

Compatibility identifiers retain the `@openleash/client-api`, `OPENLEASH_*`,
`openleash.*`, service/image, and route names where installed clients depend on
them. Existing `/v1/plugins` and `/v1/plugin-runtime/*` routes operate only on
first-party Features and never launch Feature containers.

## Data and transport

Postgres remains required for both modes. Agent hooks call the configured
Engine API. The local proxy covers provider traffic that hook APIs cannot see,
while normalized event fingerprints deduplicate hook and proxy copies. The
optional provider sync worker schedules retrospective provider ingestion; it
does not own credentials, checkpoints, policy, or event state.
