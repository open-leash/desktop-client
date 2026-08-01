# OpenLeash Client View Model

OpenLeash clients should render the same backend-owned product model with platform-native UI.

This applies to:

- desktop-client
- mobile-client
- main-web account surfaces for individuals
- dashboard-web / CISO surfaces for organizations

## Source Of Truth

The backend is the source of truth for:

- authenticated user and organization scope
- agents and devices
- pending decisions and approval state
- plugin catalog and installed plugins
- plugin categories, icons, colors, and package identity
- plugin settings schemas and effective config
- plugin outcomes, usage, logs, and audit records
- organization policy overlays such as mandatory plugins, locked settings, org defaults, and employee flexibility

Clients may cache this model for offline viewing, faster startup, and local UX continuity. Cached data is not policy authority.

## Shell Sections

Clients may have fixed product shell sections:

- overview
- agents
- activity/history
- approvals
- policies/guardrails
- settings
- identity/account

These sections summarize backend data and may adapt per platform.

## Plugin Navigation

Plugin functionality should use this structure:

```text
Category
  -> installed plugin package
       -> outcomes
       -> settings
```

Default categories:

- Visibility
- Cost
- Security
- Misc

The exact category metadata should come from backend-owned plugin/catalog metadata. Clients should not add hardcoded first-party pages such as DLP or compression.

## Outcome Shape

Outcome records should let a client render:

- plugin package id
- category/domain
- title
- summary
- severity/status/decision
- time
- affected user/device/agent/session when authorized
- evidence or structured details when available
- correlation keys when available

Desktop, mobile, main-web, and dashboard may render different density, but they should use the same fields and semantics.

## Settings Shape

Plugin settings belong to the plugin manifest/config schema plus effective policy overlays:

- user setting value
- org default value
- mandatory plugin state
- locked setting state
- user can change / cannot change

Clients should render settings from schemas instead of plugin-specific branches.

## Hook And Notification Flow

Installed agent hooks call the configured managed `client-api` endpoint directly:

```text
https://api.openleash.com/v1/hooks/:agent/:event
```

Private Cloud deployments use the customer-hosted `client-api` URL.

The managed API runs plugin evaluation and policy evaluation. If a plugin or policy needs user input, the backend creates a pending decision and fans it out to the user's available clients:

- desktop tray/client
- mobile approval companion
- main-web account surface
- dashboard/CISO views when authorized

Clients resolve decisions through authenticated APIs. They do not impersonate another user, organization, device, or plugin.
