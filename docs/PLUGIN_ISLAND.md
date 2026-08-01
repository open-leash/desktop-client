# Plugin Island Contributions

The Live Sessions island is an OpenLeash product surface. Plugins may contribute structured information to it, but they do not render UI. This keeps the island consistent, accessible, secure, and portable across desktop releases while letting plugins own the logic and wording behind their results.

## Developer Contract

Declare the narrow display permission in the manifest:

```ts
permissions: ["event:read", "tool:read", "island:publish"]
```

Then publish one of three contribution types:

```ts
await capabilities.island.annotateSession({
  key: "destructive-risk",
  label: "Destructive filesystem operation",
  detail: "Recursive deletion affects this workspace.",
  value: "critical",
  tone: "danger",
  ttlSeconds: 180,
  action: { id: "open", label: "Open session", type: "open-session" }
});

await capabilities.island.reportActivity({
  key: "test-suite",
  title: "Test suite running",
  detail: "18 of 24 tests passed.",
  status: "running",
  progress: { current: 18, total: 24, label: "18 / 24" }
});

await capabilities.island.publishStatus({
  key: "release",
  title: "Release verification",
  detail: "Checking the production installer.",
  relatedSessionIds: [input.request.event.sessionId],
  tone: "info"
});
```

- `annotateSession` adds a compact plugin result to one session.
- `reportActivity` displays work or progress owned by the plugin for one session.
- `publishStatus` displays ambient plugin state and may relate it to several sessions.
- `clear({ key, sessionId? })` removes a contribution before its expiry.

Session IDs, agent kind, exact authenticated/enrolled agent runtime ID, and project path are inferred from the current event for session-scoped methods. `key` is a stable plugin-owned identifier used for updates. Re-publishing the same plugin, key, user, and session replaces the prior value instead of creating duplicates.

## Display And Safety Rules

OpenLeash owns layout, typography, colors, animation, density, accessibility, truncation, and navigation. Plugins supply bounded data only. They cannot send HTML, CSS, JavaScript, Electron IPC names, URLs, shell commands, or custom components.

Supported tones are `neutral`, `info`, `success`, `warning`, and `danger`. Supported actions are deliberately small:

- `open-session`
- `open-plugin-settings`
- `open-plugin-outcome`

The host validates every contribution, caps text and progress values, scopes data to the current organization/user/plugin, and expires it after 5–3600 seconds. Before rendering, OpenLeash resolves the same organization/user and agent-kind/exact-agent profiles used for plugin execution. A contribution is hidden when the plugin is disabled for that request scope; plugins never reproduce this visibility logic. The default expiry is 120 seconds, so plugins should refresh live state and clear completed state promptly.

## Container Plugins

Container plugins use the same schema in their signed transform response and never receive OpenLeash database or UI access:

```json
{
  "protocol": "openleash-container-plugin.v1",
  "correlationId": "request-correlation-id",
  "status": "passed",
  "emissions": {
    "island": [{
      "kind": "activity",
      "key": "scan",
      "title": "Repository scan",
      "status": "running",
      "progress": { "current": 42, "total": 100 }
    }]
  }
}
```

The runtime accepts at most 16 contributions per response, checks the `island:publish` permission, normalizes them through the same host contract, and persists them through OpenLeash.

## Boundary

Use island contributions for short-lived, glanceable state. Use `signals.emit` and `usage.record` for durable outcomes and analytics, `notification.send` for an interruption, `storage` for plugin-owned state, and manifest `configSchema` for settings. A plugin may emit both an island contribution and a durable outcome when both live context and history matter.
