<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:F59E0B,45:10B981,100:111827&height=220&section=header&text=Desktop%20Client&fontSize=52&fontColor=ffffff&fontAlignY=38&desc=Local-first%20agent%20hooks%20and%20approvals.&descSize=18&descAlignY=58" width="100%" />

<p>
  <img src="https://img.shields.io/badge/Electron-desktop-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img src="https://img.shields.io/badge/Local%20First-hooks-F59E0B?style=for-the-badge" />
  <img src="https://img.shields.io/badge/SQLite-standalone-003B57?style=for-the-badge&logo=sqlite&logoColor=white" />
</p>

<h3>🖥 Unleash your agents with a local control point.</h3>

</div>

---

## ✨ What this app is

`desktop-client` is the installed OpenLeash client: tray app, local API, approval UI, hook installer, local SQLite store, update checks, and deployment CLI.

Installed hooks call the desktop local API first:

```text
http://127.0.0.1:9317/v1/hooks/:agent/:event
```

That keeps Local mode useful without the internet. In managed modes, the desktop client forwards to `client-api` or OpenLeash Cloud when reachable.

---

## 🚀 Modes

| Mode | Behavior |
| --- | --- |
| 🖥️ Local mode | Local API, local SQLite, user LLM key or deterministic fallback. |
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

- Hooks stay local-first.
- Install changes are explicit and reversible.
- Offline behavior should remain understandable.
- Users should see what changed and how to undo it.
- Risky actions should feel clear, not spooky.

---

## 🛡 Security notes

The Electron renderer uses context isolation, sandboxing, no Node integration, and guarded external URL opening.

Keep it that way.

<div align="center">

### Fast agents. Local checkpoint. Human confidence.

</div>
