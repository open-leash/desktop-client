# Plugin Outcomes

OpenLeash plugins should produce user-facing outcomes, not hardcoded dashboard pages.

The plugin is the engine. The backend is the source of truth. Product surfaces render categories, installed plugins, settings, and outcomes from the same `client-api` and `dashboard-api` records.

Plugin identity should stay canonical and package-like. For example, the token-saving prompt plugin is `token-saver`, not a title-cased marketing label such as `Token Saver`. Friendly explanatory copy can appear in descriptions, but plugin names should remain unique, stable identifiers.

Plugin artwork is part of that identity. Catalog cards, plugin detail pages, install handoff pages, desktop, mobile, and dashboard surfaces should resolve the same uploaded or first-party icon for a plugin. Category icons and colors are secondary metadata, not replacement plugin artwork.

The product surfaces are grouped by category and outcome:

- Rules Enforcement
- Sensitive Access
- `blast-radius`
- Data Protection
- MCP and Tool Risk
- Skill Review
- token-saver
- Exports and Operations

Users should feel at home across desktop, mobile, main-web account pages, and dashboard surfaces. Each platform can adapt density and navigation to its form factor, but they should all use the same categories, plugin identity, icons/colors, outcome fields, and settings semantics.

Users need a clear result, evidence, impact, and configuration. They may also need to know the plugin package that produced it when managing installed plugins or debugging behavior.

## Cross-Surface Contract

- `client-api` owns the user-facing plugin catalog, user plugin settings, and user plugin outcomes.
- `dashboard-api` owns organization/CISO views over the same concepts, including mandatory plugins, org defaults, locked settings, and employee flexibility.
- Desktop, mobile, main-web account pages, and dashboard-web should not maintain separate fixed screens for specific first-party plugins. They should render from plugin manifests, category metadata, config schemas, and emitted outcomes.
- Organization policy can make a plugin mandatory, set org defaults, block user installs, or lock config. Otherwise plugin settings are user-scoped.
- Individual OpenLeash Cloud users can live under the shared hosted organization model, but their plugin choices and settings remain per-user unless a real parent organization policy says otherwise.

## Hook Identity Contract

Installed hooks identify the user, device, and agent/runtime when they call OpenLeash. The managed API is the default hook target:

```text
https://api.openleash.com/v1/hooks/:agent/:event
```

Private Cloud installs use the customer-hosted `client-api` URL. This direct managed endpoint matters because an agent may later run in a provider cloud while preserving the same hook URL; localhost would not be reachable there. The resulting events and plugin outcomes must appear in the same desktop, mobile, main-web account, and CISO dashboard surfaces.

## What Plugins Emit

Plugins report durable records through capabilities:

```ts
await capabilities.signals.emit({
  kind: "security.finding",
  severity: "high",
  title: "Destructive command blocked",
  summary: "The agent attempted to remove a protected directory.",
  decision: "blocked",
  status: "blocked",
  target: { type: "tool_call", name: "bash" },
  evidence: [
    { label: "Command", value: "rm -rf production-data", kind: "code", sensitive: false }
  ],
  details: {
    policyName: "Protect production data"
  },
  correlationKeys: ["policy:Protect production data", "tool:bash"]
});
```

Use:

- `signals.emit` for findings, decisions, incidents, inventory, health, and export status.
- `usage.record` for token savings, provider usage, cost, compute, storage, and egress.
- `log.emit` for diagnostic and audit breadcrumbs.
- `storage` for plugin-owned state.
- `island` for short-lived, structured Live Sessions annotations, activity, and status. See [Plugin Island Contributions](./PLUGIN_ISLAND.md).

## Outcome Mapping

OpenLeash maps plugin records into outcome domains:

| Signal kind | Outcome domain |
| --- | --- |
| `security.finding`, `policy.decision` | Security |
| `secret.detected` | Data Protection |
| `tool.risk`, `mcp.discovery` | MCP and Tool Risk |
| `identity.risk` | Identity |
| `plugin.health`, `export.status` | Operations |

The dashboard reads outcome records from `/admin/outcomes`.

## Evidence Guidelines

Evidence should be structured and short.

Good evidence:

```ts
evidence: [
  { label: "Policy", value: "No destructive shell commands" },
  { label: "Command", value: "rm -rf ./data", kind: "code" },
  { label: "Project", value: "/repo/payments-api", kind: "path" }
]
```

Avoid dumping raw payloads unless they are already redacted. Mark sensitive values:

```ts
{ label: "Secret-like value", value: "sk-...abcd", sensitive: true }
```

## Configuration

Plugin configuration belongs in the plugin manifest:

```ts
configSchema: {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    riskThreshold: { type: "number", minimum: 0, maximum: 100 },
    action: { enum: ["observe", "ask", "block"] }
  }
}
```

OpenLeash should render this as a clean settings panel from the schema. The same schema-driven setting should work in desktop, mobile, dashboard-web, and any account page, with platform-appropriate layout.

## Product Rule

If a plugin emits a record, a human should be able to answer:

1. What happened?
2. Who or what was affected?
3. Why did OpenLeash decide that?
4. What evidence supports it?
5. What setting controls this behavior?

If the record cannot answer those questions, improve the plugin output before adding more UI.
