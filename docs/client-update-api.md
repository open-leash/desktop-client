# OpenLeash Client Update API

OpenLeash uses the main client API for app update distribution. Update checks live beside the other client-facing endpoints, while dashboard/admin product views stay on `dashboard-api`.

## Services

- Managed cloud update API: the OpenLeash-hosted `client-api` endpoint
- Local development API: `http://localhost:9318/api/updates/check`
- Static compatibility endpoint: `/api/updates/latest`
- Admin release publishing endpoint: `/api/admin/releases`

Update metadata uses the main OpenLeash API Postgres database by default. Set `OPENLEASH_RELEASE_DATABASE_URL` only if a deployment wants update metadata in a separate database.

## Client Request

The desktop app checks once per day automatically, and users can also use the tray menu item or CLI update command.
Every OpenLeash API call includes a function-level contract version:

```http
x-openleash-api-function: clientUpdateCheck
x-openleash-api-version: 2026-05-16.client-update-check.v1
```

Servers return the same headers and reject mismatched versions with `426 Upgrade Required`. Missing headers are accepted for old clients during rollout, but every current OpenLeash consumer sends them.

```json
{
  "app": "openleash-personal",
  "version": "0.1.0",
  "platform": "darwin",
  "arch": "arm64",
  "channel": "stable",
  "installMode": "personal",
  "updateSource": "public"
}
```

## Client Response

```json
{
  "updateAvailable": true,
  "latestVersion": "0.1.1",
  "currentVersion": "0.1.0",
  "channel": "stable",
  "platform": "darwin",
  "arch": "arm64",
  "dmgUrl": "https://downloads.openleash.com/OpenLeash-0.1.1-arm64.dmg",
  "sha256": "...",
  "notesUrl": "https://openleash.com/releases/0.1.1",
  "publishedAt": "2026-05-16T12:00:00.000Z"
}
```

## Publish A Release

Set `OPENLEASH_RELEASE_ADMIN_TOKEN`, then:

```bash
curl -X POST http://localhost:9318/api/admin/releases \
  -H "authorization: Bearer $OPENLEASH_RELEASE_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "version": "0.1.1",
    "channel": "stable",
    "platform": "darwin",
    "arch": "arm64",
    "dmgUrl": "https://downloads.openleash.com/OpenLeash-0.1.1-arm64.dmg",
    "sha256": "replace-with-sha256",
    "releaseNotes": "Small fixes and update reliability improvements."
  }'
```

## Private / On-Prem Update Modes

Private deployments can choose one of three modes:

- `OPENLEASH_UPDATE_MODE=public`: clients use the configured managed cloud update endpoint.
- `OPENLEASH_UPDATE_MODE=private`: clients use `OPENLEASH_UPDATE_FEED_URL`, which can point to a private OpenLeash API update endpoint or static JSON feed.
- `OPENLEASH_UPDATE_MODE=manual`: clients do not check public updates; IT distributes DMGs manually or through MDM.

Static JSON is still supported for simple private distribution:

```json
{
  "version": "0.1.1",
  "dmgUrl": "https://openleash.company.com/releases/OpenLeash-0.1.1-arm64.dmg",
  "sha256": "replace-with-sha256",
  "notesUrl": "https://openleash.company.com/releases/0.1.1"
}
```
