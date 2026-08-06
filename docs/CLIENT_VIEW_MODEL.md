# Leash client view model

`client-api` returns one normalized personal view model for desktop, mobile, and web. It contains agent sessions, attention events, Feature outcomes, Feature settings, and summary counts.

Built-in Features are identified by stable compatibility IDs such as `openleash.dlp`, but clients display their Feature slug and Leash branding. The model does not expose publisher profiles, ratings, install counts, download counts, organization policy, dashboard roles, or identity configuration.

Clients may render different densities while preserving these semantics:

- `enabled` means the personal user enabled the Feature.
- `runtimeAvailable` means the release contains a registered in-process handler.
- an outcome belongs to the Feature that produced the decisive signal.
- attention events are scoped to the authenticated personal account and exact agent session.
