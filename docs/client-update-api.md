# Client update API

Leash desktop update endpoints live on the personal `client-api`:

- `POST /api/updates/check`
- `GET /api/updates/latest`
- `POST /api/admin/releases` for the authenticated release publisher only

The update record is selected by app ID, stable channel, platform, architecture, rollout percentage, and current version. Every active record includes an HTTPS artifact URL, SHA-256, byte size, release notes, and publication time.

The release publisher verifies the GitHub release is stable, downloads the artifact, checks its checksum and size, publishes the feed record, and immediately reads it back. macOS and Windows assets must use the same desktop version.
