# Google OAuth Setup

OpenLeash uses one Web OAuth client for browser/API auth plus native OAuth clients for the mobile app identifiers.

## Web Client

Use this for the API, dashboard, main website, and desktop client browser sign-in.

Environment variables:

```bash
OPENLEASH_GOOGLE_CLIENT_ID=
OPENLEASH_GOOGLE_CLIENT_SECRET=
OPENLEASH_GOOGLE_REDIRECT_URI=
```

Local redirect URI:

```text
http://localhost:9317/v1/auth/google/callback
```

Managed deployment redirect URI:

```text
https://api.your-openleash-domain.example/v1/auth/google/callback
```

Recommended local JavaScript origins:

```text
http://localhost:9300
http://localhost:4000
http://localhost:9317
```

Recommended managed deployment JavaScript origins:

```text
https://your-openleash-domain.example
https://dashboard.your-openleash-domain.example
https://api.your-openleash-domain.example
```

## iOS Client

Bundle ID:

```text
com.openleash.mobile
```

The iOS app must include the reversed client ID as a URL scheme in `apps/mobile-client/ios/Runner/Info.plist`.

## Android Client

Package name:

```text
com.openleash.mobile
```

Debug SHA-1:

```text
Use the SHA-1 from your local Android debug keystore.
```

Debug SHA-256:

```text
Use the SHA-256 from your local Android debug keystore.
```

Create a separate Android OAuth client for release signing when a production keystore exists.
