# OpenLeash Mobile Client

OpenLeash Mobile Client is the Flutter iOS and Android companion for OpenLeash Client. It connects to the same API as the desktop client, signs existing users in with the API's identity provider, registers the phone, and lets the user approve or deny pending agent actions. The mobile app does not create accounts or start signup.

## Client Flow

1. Choose sign-in target:
   - Managed OpenLeash Cloud uses the OpenLeash-hosted API configured in the released app.
   - Managed self-hosted points at a customer API, such as `https://api.company.com`.
2. Discover login:
   - The API returns the identity provider configured for that organization slug.
3. Sign in:
   - The app opens the provider authorization URL.
   - The provider redirects back to the `openleash://auth/callback` deep link.
   - The app exchanges the code through `/v1/mobile/auth/exchange`.
   - If the email does not already belong to an OpenLeash user, the API rejects the mobile sign-in instead of provisioning a new account.
4. Register the device:
   - The app asks for notification permission.
   - It stores the device record with `/v1/mobile/devices`.
5. Approve actions:
   - The app syncs `/v1/mobile/state` and polls while it is open.
   - Pending approvals are shown in-app and as notifications with Allow and Deny actions.
   - Taps call `/v1/mobile/decisions/:id/resolve`.
   - Store builds should wire APNs and FCM credentials for background push delivery. The current Flutter client supports local actionable notifications from the polling state.

## API Contracts

All mobile endpoints participate in the OpenLeash version headers:

- `GET /v1/mobile/bootstrap`
- `POST /v1/mobile/auth/start`
- `POST /v1/mobile/auth/exchange`
- `POST /v1/mobile/devices`
- `GET /v1/mobile/state`
- `POST /v1/mobile/decisions/:id/resolve`

## Required Production Credentials

Create these when moving from local/dev to production:

- `OPENLEASH_GOOGLE_CLIENT_ID`
- `OPENLEASH_GOOGLE_CLIENT_SECRET`
- iOS bundle identifier: `com.openleash.mobile`
- iOS associated URL/deep-link scheme: `openleash://auth/callback`
- Android package: `com.openleash.mobile`
- Android OAuth SHA-256 certificate fingerprint
- APNs key ID, team ID, bundle ID, and private key for iOS push
- FCM project ID and service account JSON for Android push

For self-hosted APIs, configure the organization identity provider in the dashboard first. The mobile app discovers that provider from the selected API and organization slug.

## Local Development

Run from the repo root:

```bash
npm run mobile-client
```

Or directly:

```bash
cd apps/mobile-client
flutter run
flutter run -d ios
flutter run -d android
```

For local API testing, point the app at the API URL exposed to the simulator or device. On iOS Simulator, `http://localhost:9318` works. On a physical phone, use your Mac's LAN IP.

For dev-only login without a real Google OAuth client, set:

```bash
OPENLEASH_MOBILE_DEV_AUTH=1
OPENLEASH_MOBILE_DEV_EMAIL=max@example.com
OPENLEASH_MOBILE_DEV_NAME="Max Brin"
```

Production should not enable `OPENLEASH_MOBILE_DEV_AUTH`.
