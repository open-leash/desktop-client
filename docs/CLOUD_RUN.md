# Leash Cloud deployment notes

The public repository provides the personal `client-api` core and clients. Production Leash Cloud composes hosted provisioning, billing, credentials, abuse controls, and operations outside this repository.

The public service exposes only the client API surface. It must not start a dashboard API, identity-provider loader, organization onboarding flow, marketplace, or third-party Feature runtime.

Deploy Postgres migrations before the API. Then verify health, personal authentication, desktop enrollment, hooks, proxy evaluation, built-in Feature verification, mobile approvals, update checks, and rollback behavior.
