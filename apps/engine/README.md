# Leash client API

`client-api` is the single personal backend used by Leash Cloud and Personal Open Source. It evaluates normalized agent events, records outcomes, manages approvals and structured questions, serves desktop/mobile/web state, stores personal Feature settings, and publishes desktop updates.

## Built-in Features

Features live under `src/plugins`, are registered in `feature-runtime.ts`, and execute directly in the Node.js process. Each Feature has a reviewed manifest, bounded capabilities, settings schema, and tests. There is no Feature container, Docker gateway, third-party upload, public marketplace, publisher profile, rating, or download counter.

To add a Feature:

1. Add its TypeScript handler and manifest under `src/plugins`.
2. Register the handler in the closed Feature registry.
3. Add representative fixtures for every supported decision/effect.
4. Add the manifest to the first-party catalog.
5. Run typecheck, unit tests, and the clean Personal Open Source installation gate.

Stable `openleash.*` IDs, package names, environment variables, and `/v1/plugins` routes remain compatibility contracts.

## Run

```bash
npm run build -w @openleash/shared
npm run db:migrate -w @openleash/client-api -- --apply
npm run dev -w @openleash/client-api
```

The shipped server is permanently client-only. Dashboard, organization, SSO/IdP, marketplace, and upload endpoints cannot be enabled by an API-surface environment flag.
