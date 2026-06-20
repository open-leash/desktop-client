<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:F59E0B,45:10B981,100:111827&height=220&section=header&text=Desktop%20Client&fontSize=52&fontColor=ffffff&fontAlignY=38&desc=Backend-backed%20agent%20hooks%20and%20approvals.&descSize=18&descAlignY=58" width="100%" />

<p>
  <img src="https://img.shields.io/badge/Electron-desktop-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img src="https://img.shields.io/badge/Local%20Relay-hooks-F59E0B?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Backend-required-10B981?style=for-the-badge" />
</p>

<h3>🖥 Unleash your agents with a local control point.</h3>

</div>

---

## ✨ What this app is

`desktop-client` is the installed OpenLeash client: tray app, local hook relay API, approval UI, hook installer, update checks, and deployment CLI.

Installed hooks call the desktop local API first:

```text
http://127.0.0.1:9317/v1/hooks/:agent/:event
```

The desktop client forwards hook traffic to an OpenLeash backend: either OpenLeash Cloud or a customer-hosted Private Cloud `client-api`. If the backend is unavailable, enforcement fails closed instead of running a fully local SQLite-backed product mode.

---

## 🚀 Modes

| Mode | Behavior |
| --- | --- |
| 🏢 Private Cloud | Local API forwards to customer-hosted `client-api`. |
| ☁️ OpenLeash Cloud | Local API forwards to OpenLeash-hosted cloud APIs. |

---

## 🛠 Run locally

Best path:

```bash
python3 run.py
```

Direct app run:

```bash
npm install
npm run desktop-client
```

CLI examples:

```bash
npm run desktop-cli -- discover
npm run desktop-cli -- install-hooks --all
npm run desktop-cli -- configure --token "$OPENLEASH_TOKEN" --api-url http://127.0.0.1:9317
```

---

## 🪝 Hook philosophy

- Hooks enter through the local desktop relay.
- Install changes are explicit and reversible.
- Backend outages fail closed with a clear reason.
- Users should see what changed and how to undo it.
- Risky actions should feel clear, not spooky.

---

## 🛡 Security notes

The Electron renderer uses context isolation, sandboxing, no Node integration, and guarded external URL opening.

Keep it that way.

<div align="center">

### Fast agents. Local relay. Human confidence.

</div>
