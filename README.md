<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:F59E0B,45:10B981,100:111827&height=220&section=header&text=Desktop%20Client&fontSize=52&fontColor=ffffff&fontAlignY=38&desc=Backend-backed%20agent%20hooks%20and%20approvals.&descSize=18&descAlignY=58" width="100%" />

<p>
  <img src="https://img.shields.io/badge/Electron-desktop-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img src="https://img.shields.io/badge/Local%20Relay-hooks-F59E0B?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Backend-required-10B981?style=for-the-badge" />
</p>

<h3>🖥 Control your agents with a local control point.</h3>

</div>

---

## ✨ What this app is

`desktop-client` is the installed OpenLeash client: tray app, local helper API, approval UI, hook installer, update checks, and deployment CLI.

The attention island is a non-activating, top-center overlay for the moments
when an agent needs a person. It presents OpenLeash policy approvals, native
agent questions and plan reviews, blocked actions, and completion notices
without opening the main window or stealing focus from the terminal.

Native interaction support is capability-based:

| Agent adapter | Policy approvals | Native questions | Plan review | Completion |
| --- | --- | --- | --- | --- |
| Claude Code / NanoClaw | Yes | Yes, answers resume the hook | Yes | Yes |
| OpenCode | Yes | Yes, answers use OpenCode's question API | Agent-dependent | Yes |
| Codex / Copilot / Gemini and other installed hooks | Yes | When their stable hook contract exposes structured answers | When exposed | When their stop hook is available |

The overlay is implemented with Electron primitives available on macOS and
Windows (`showInactive`, frameless transparent windows, skip-taskbar, and
always-on-top). "Open agent" activates a likely host application; it is not
described as an exact session jump unless that agent publishes a stable deep
link.

Enabled plugins can contribute typed, expiring annotations, activity, progress,
and ambient status to Live Sessions through the shared Island API. OpenLeash
owns layout, accessibility, truncation, animation, and safe navigation. Plugins
cannot inject HTML, CSS, JavaScript, arbitrary URLs, shell commands, or custom
Electron IPC.

Installed hooks call the configured managed OpenLeash API:

```text
https://api.openleash.com/v1/hooks/:agent/:event
```

Private Cloud installs use the customer-hosted `client-api` URL. The desktop local API still exists for setup, tray state, OAuth callbacks, local cache, local development, and legacy/dev relay behavior. If the managed backend is unavailable, enforcement fails closed instead of running a fully local SQLite-backed product mode.

---

## 🚀 Modes

| Mode | Behavior |
| --- | --- |
| 🧑‍💻 Individual Open Source | Desktop uses the locally running public `client-api` and Postgres; hooks target that local API. |
| 🏢 Private Cloud | Hooks target customer-hosted `client-api`; desktop receives state and approvals from that backend. |
| ☁️ OpenLeash Cloud | Hooks target OpenLeash-hosted cloud APIs; desktop receives state and approvals from OpenLeash Cloud. |

---

## 🧩 Plugin settings and organization policy

Personal users can configure plugins globally, by agent kind, or by exact
authenticated/enrolled agent runtime. In organization modes, desktop displays
the effective backend-owned policy: mandatory plugins cannot be removed or
disabled, optional installs may be blocked, and settings may be locked. When an
admin leaves configuration unlocked, employees may keep personal and per-agent
settings even for a mandatory plugin.

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
npm run desktop-cli -- plugins list --search token
npm run desktop-cli -- plugins install token-saver sec-evaluator
npm run desktop-cli -- plugins uninstall token-saver sec-evaluator
npm run desktop-cli -- configure --token "$OPENLEASH_TOKEN" --remote-api-url https://api.openleash.com
```

---

## 🪝 Hook philosophy

- Hooks enter through the managed OpenLeash API so local and provider-cloud agent runs use the same URL.
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
