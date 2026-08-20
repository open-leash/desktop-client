# Leash Mobile Store Submission Checklist

Last updated: 2026-06-11

## Public URLs

- Privacy Policy URL: `https://openleash.com/privacy`
- Support URL: `https://openleash.com/support`
- Account deletion URL: `https://openleash.com/account/delete`
- Marketing URL: `https://openleash.com`

## App behavior summary

Leash Mobile is an approval companion for existing Leash Cloud and Private Cloud users. It signs in with Google, Microsoft, or a customer-hosted identity provider, registers the device, polls the configured Leash API, shows pending approval requests, and sends allow/deny decisions.

The app requests:

- Internet access, to reach Leash Cloud or a customer-hosted API.
- Notification permission, to show approval prompts.

The app does not request camera, microphone, photo library, contacts, precise location, Bluetooth, calendar, or advertising tracking permissions.

## Apple App Store Connect

- Enter the Privacy Policy URL.
- Enter the Support URL.
- Complete App Privacy answers for the data actually collected by Leash Cloud and any third-party processors.
- Provide a reviewer demo account or a fully usable demo organization.
- In Review Notes, explain that Private Cloud users can point the app at their customer-managed API URL.
- Confirm the bundled `ios/Runner/PrivacyInfo.xcprivacy` matches the final binary and any SDKs added later.

Suggested App Privacy categories to review before submission:

- Contact Info: name and email address, linked to the user, app functionality.
- Identifiers: user ID and device ID, linked to the user, app functionality.
- Product Interaction: approval decisions and app activity, linked to the user, app functionality.
- Diagnostics: declare only if crash or diagnostic tooling is added.
- Tracking: no, unless an advertising or cross-app tracking SDK is added later.

## Google Play Console

- Enter the Privacy Policy URL.
- Complete Data Safety for the final binary and all SDKs.
- Complete Data deletion questions and enter `https://openleash.com/account/delete`.
- Provide a reviewer demo account, test organization, and any custom API URL needed for review.
- Confirm the Android permissions are limited to `INTERNET` and `POST_NOTIFICATIONS` for the production manifest.

Suggested Data Safety categories to review before submission:

- Personal info: name and email address, app functionality.
- App activity: approval decisions and interaction events, app functionality and security.
- Device or other IDs: device registration identifier, app functionality and security.
- Security practices: data encrypted in transit; users can request deletion.

## Android release signing

Release signing is configured through `android/key.properties` or environment variables. Do not commit keystores or passwords.

Option A, local `android/key.properties`:

```properties
storeFile=/absolute/path/to/openleash-upload-keystore.jks
storePassword=...
keyAlias=openleash-upload
keyPassword=...
```

Option B, environment variables:

```sh
export OPENLEASH_ANDROID_KEYSTORE=/absolute/path/to/openleash-upload-keystore.jks
export OPENLEASH_ANDROID_KEYSTORE_PASSWORD=...
export OPENLEASH_ANDROID_KEY_ALIAS=openleash-upload
export OPENLEASH_ANDROID_KEY_PASSWORD=...
```

Then build:

```sh
flutter build appbundle --release
```

## Final pre-upload checks

- Run `flutter analyze`.
- Run `flutter test`.
- Build an Android App Bundle with release signing.
- Archive iOS from Xcode with the App Store distribution profile.
- Verify deep link callback: `openleash://auth/callback`.
- Verify sign-in, device registration, notification permission prompt, pending approvals, allow, deny, deny with guidance, sign out, privacy link, support link, and delete-account link.
