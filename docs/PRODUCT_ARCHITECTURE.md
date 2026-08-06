# Product Architecture

The canonical product has two personal modes: Leash Cloud and Personal Open Source. Both use the same `client-api`, schema, Feature registry, event normalization, and clients.

The open-source boundary contains desktop, mobile, client API, local proxy, docs, marketing, shared contracts, Postgres deployment, and first-party Feature implementations. Admin dashboards, dashboard APIs, organization management, customer IdP services, billing adapters, and private hosted operations are not public packages.

Feature implementations belong beside `client-api` in TypeScript. Add a handler, reviewed manifest, settings schema, and tests; do not create a container image, repository marketplace entry, upload flow, or sandbox service.
