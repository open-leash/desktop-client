# OpenLeash Desktop Client 🪝🖥️

[![Desktop](https://img.shields.io/badge/desktop-electron-111718)](#)
[![Local First](https://img.shields.io/badge/local--first-hooks-0c8b67)](#)
[![CLI](https://img.shields.io/badge/includes-cli-3975a8)](#)

The installed OpenLeash client: tray app, local API, approval UI, hook installer, local storage, and deployment CLI.

## Why It Exists

Agent hooks should call the desktop local API first:

```text
http://127.0.0.1:4317/v1/hooks/:agent/:event
```

That keeps OpenLeash useful offline. In managed modes, the desktop client forwards to the configured `client-api` or OpenLeash Cloud when reachable.

## Run

```bash
npm install
npm run desktop-client
```

CLI examples:

```bash
npm run desktop-cli -- discover
npm run desktop-cli -- install-hooks --all
npm run desktop-cli -- configure --token "$OPENLEASH_TOKEN" --api-url http://127.0.0.1:4317
```

## Modes

| Mode | Behavior |
| --- | --- |
| Standalone | Local API evaluates with user-provided LLM key or fallback rules. |
| Managed private cloud | Local API forwards to customer-hosted `client-api`. |
| OpenLeash Cloud | Local API forwards to OpenLeash-hosted `cloud-client-api`. |

## Hook Philosophy

- Install only explicit, reversible config.
- Keep hooks local-first.
- Preserve offline behavior.
- Show users what changed and how to remove it.

## Security Notes

The Electron renderer runs with context isolation, sandboxing, no Node integration, and guarded external URL opening. Keep it that way.
