# OpenLeash Client Install

OpenLeash Client ships with two install paths:

- Human install: open the DMG and drag `OpenLeash.app` into Applications.
- Scripted install: run `install-openleash-personal.sh` beside the DMG.

## Scripted install

Install from the DMG in the same folder:

```bash
./install-openleash-personal.sh
```

Before replacing configuration, the scripted installer removes every previous OpenLeash hook and plugin, restores agent proxy settings, removes the local proxy container, clears cached hook endpoint credentials, and then writes the selected configuration again. Reinstalling is therefore safe even when a previous installation was interrupted.

The desktop client requires an OpenLeash backend. Individuals use OpenLeash Cloud; organizations can point the same client at their Private Cloud API URL and enrollment token.

Managed installs can point the same client at the API URL and token issued by the organization dashboard:

```bash
./install-openleash-personal.sh \
  --api-url "<managed-api-url>" \
  --token "<deployment-token>" \
  --mode "<cloud|self-hosted>" \
  --enroll \
  --install-hooks
```

Install with a local rules file for bootstrap/testing:

```bash
./install-openleash-personal.sh \
  --rules ./company-rules.json \
  --replace-rules
```

Install from a hosted DMG:

```bash
./install-openleash-personal.sh \
  --dmg https://downloads.example.com/OpenLeash-0.1.0-arm64.dmg \
  --rules ./company-rules.json \
  --replace-rules \
  --quiet
```

Install only, without opening the app:

```bash
./install-openleash-personal.sh --no-launch
```

Keep existing local settings during reinstall:

```bash
./install-openleash-personal.sh --keep-settings
```

The preserved setup is used to regenerate the client configuration and agent integrations after cleanup.

Fully uninstall OpenLeash and restore every managed agent configuration:

```bash
./install-openleash-personal.sh --uninstall
```

The uninstaller stops OpenLeash, restores hook and proxy configuration, removes the proxy container and Individual Open Source backend, disables login/protocol registration, and then deletes the application and OpenLeash-owned local state. It stops if safe agent restoration cannot be completed.

## Updates

OpenLeash checks for personal updates automatically once a day. Users can also choose **Check for updates** from the tray menu.

Trigger an update check from the command line:

```bash
open -a OpenLeash --args --update
```

You can also call the app executable directly:

```bash
/Applications/OpenLeash.app/Contents/MacOS/OpenLeash --update
```

Install the newest available update without a prompt:

```bash
open -a OpenLeash --args --update --yes
```

By default the app reads the latest-version manifest from the OpenLeash update feed. For private deployments, pass your own manifest URL:

```bash
open -a OpenLeash --args \
  --update \
  --update-feed https://downloads.example.com/openleash/latest.json
```

The update feed is a small JSON file with the newest version and DMG URL. See `docs/personal-update-feed.example.json`.

## Rule import

Rules can be imported from the app during setup, from the Rules page, or through CLI launch arguments:

```bash
open /Applications/OpenLeash.app --args \
  --import-rules ./company-rules.json \
  --replace-rules
```

For rule JSON format, see `docs/personal-rules.example.json`.

## Enterprise note

DMG plus shell install is useful for simple scripted deployments. A signed `.pkg` is the better next step for larger enterprise rollouts because it is purpose-built for silent install tools and package receipts, even when no MDM integration is required.
