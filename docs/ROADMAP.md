# OpenLeash Roadmap

## Product tracks

1. Open-source core: OpenLeash Client, Private Cloud API/dashboard/Postgres, BYOK provider configuration, DMG/PKG/MSI install, updater.
2. OpenLeash Cloud: hosted multi-tenant API/dashboard, CISO dashboard, managed rules, Google/SSO/OAuth, MDM deployment, OpenLeash-managed Postgres.
3. Private/cloud extensions: closed-source hosted adapters for billing, quotas, production credentials, compliance exports, multi-org operations, paid support, and advanced detection where needed.

## Next build slice

1. Keep OpenLeash Client install/update paths consistent across OpenLeash Cloud and Private Cloud.
2. Add signed macOS PKG and Windows MSI builds for MDM.
3. Add enterprise enrollment command and deployment tokens.
4. Add SSO/OAuth for Okta, Google Workspace, and Microsoft Entra ID.
5. Replace tray polling with WebSocket/SSE push for lower latency.
6. Add retention worker for tenant-scoped conversation log expiry.
7. Add richer per-agent icons and verified vendor metadata.

## Agent adapters

- Claude Code: productionizable now through documented hooks.
- Codex: adapter present, but verify hook schema against the installed Codex version.
- Cursor and other IDE agents: add adapter once their hook/event surfaces are confirmed.
