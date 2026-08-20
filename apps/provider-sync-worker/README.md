<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:F59E0B,45:EA580C,100:111827&height=220&section=header&text=Provider%20Puller&fontSize=54&fontColor=ffffff&fontAlignY=38&desc=Scheduled%20discovery%20for%20hosted%20enterprise%20agents.&descSize=18&descAlignY=58" width="100%" />

<p>
  <a href="https://openleash.com"><img src="https://img.shields.io/badge/OpenLeash-openleash.com-F59E0B?style=for-the-badge&logo=googlechrome&logoColor=white" /></a>
  <a href="https://docs.openleash.com"><img src="https://img.shields.io/badge/Docs-docs.openleash.com-EA580C?style=for-the-badge&logo=readthedocs&logoColor=white" /></a>
  <img src="https://img.shields.io/badge/License-MIT-111827?style=for-the-badge&logo=opensourceinitiative&logoColor=white" />
</p>

<p>
  <img src="https://img.shields.io/badge/Node-%E2%89%A522-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Runtime-container%20worker-2563EB?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Output-normalized%20agent%20events-F59E0B?style=for-the-badge" />
</p>

<h3>☁️ Bring hosted agent activity into the same OpenLeash decision and audit pipeline.</h3>

</div>

---

## ✨ What this app is

`provider-puller` is OpenLeash's small, deployable scheduler for SaaS and cloud agent platforms that expose activity through provider APIs instead of a local model connection. It asks `client-api` to synchronize configured providers on a fixed interval; provider connectors fetch, normalize, deduplicate, and process the actual activity.

```text
Salesforce Agentforce ─┐
Google Vertex AI ──────┼─► client-api connectors ─► normalized event pipeline
Copilot Studio ────────┘             ▲
                                     │
                              provider-puller
                              scheduled trigger
```

Keeping scheduling separate makes the worker stateless and horizontally disposable while `client-api` remains the source of truth for credentials, checkpoints, normalization, policy, and audit data.

---

## 🔥 Responsibilities

- Trigger configured provider synchronizations on startup and on a fixed interval
- Synchronize providers concurrently so a slow platform does not serialize the cycle
- Emit structured JSON success and failure logs per provider
- Authenticate to the administrative sync surface of `client-api`
- Apply bounded request timeouts and continue future cycles after individual failures

The default provider set is:

- Salesforce Agentforce
- Google Vertex AI
- Microsoft Copilot Studio

---

## 🚀 Where it runs

| Mode | Role |
| --- | --- |
| 🏢 Private Cloud | Optional worker beside the customer-hosted `client-api`. |
| ☁️ OpenLeash Cloud | Hosted scheduler for enabled SaaS connectors. |
| 🧑‍💻 Individual Open Source | Optional; useful only when the user configures a supported hosted provider connector. |

---

## 🛠 Run locally

Requirements: Node.js 22 or newer and a running OpenLeash `client-api` with an administrative token.

```bash
npm install
npm run build

OPENLEASH_CLIENT_API_URL=http://127.0.0.1:9318 \
OPENLEASH_ADMIN_TOKEN=replace-me \
npm start
```

The first synchronization runs immediately. Subsequent cycles use `OPENLEASH_PULL_INTERVAL_MS`.

---

## ⚙️ Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENLEASH_CLIENT_API_URL` | No | `client-api` base URL. Defaults to `http://127.0.0.1:9318`. |
| `OPENLEASH_ADMIN_TOKEN` | Yes* | Administrative bearer token used for sync requests. |
| `OPENLEASH_DASHBOARD_TOKEN` | Yes* | Backward-compatible token fallback. |
| `OPENLEASH_PULL_INTERVAL_MS` | No | Interval between cycles. Minimum 30 seconds; default 5 minutes. |
| `OPENLEASH_PULL_PROVIDERS` | No | Comma-separated provider IDs to synchronize. |

*Set one of the two token variables. Prefer `OPENLEASH_ADMIN_TOKEN`.

Provider credentials and checkpoints belong in `client-api`; do not place them in this worker's environment.

---

## 🐳 Container

```bash
docker build -t openleash-provider-puller .
docker run --rm \
  -e OPENLEASH_CLIENT_API_URL=https://api.example.com \
  -e OPENLEASH_ADMIN_TOKEN=replace-me \
  openleash-provider-puller
```

The image builds TypeScript in a dedicated stage and runs as the unprivileged Node user.

---

## ✅ Verify

```bash
npm run typecheck
npm run build
docker build -t openleash-provider-puller:test .
```

---

## 🔐 Security

Please report vulnerabilities according to [SECURITY.md](SECURITY.md). Do not include provider credentials, administrative tokens, or customer event data in public issues.

<div align="center">

### One pipeline for local agents and the hosted platforms they grow into.

</div>
