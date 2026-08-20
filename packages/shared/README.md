# Leash shared contracts

This package contains the public TypeScript contracts shared by Leash clients and `client-api`.

Built-in Features use stable `openleash.*` identifiers and `/v1/plugins` compatibility routes, but execute as reviewed in-process TypeScript handlers registered by `client-api`. The public product has no third-party marketplace, publisher profile, rating/download analytics, Feature image, or container protocol requirement.

Capabilities bound Feature access to instructions, recent conversation context, model evaluation, portable state, notifications, Island contributions, logs, signals, and usage. The host owns validation, redaction, scope, persistence, and presentation.

The client view model is personal-account scoped and deliberately excludes dashboard, organization policy, and identity-provider state.
