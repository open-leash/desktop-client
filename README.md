<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:22C55E,45:06B6D4,100:111827&height=220&section=header&text=Flow%20Viewer&fontSize=54&fontColor=ffffff&fontAlignY=38&desc=See%20every%20Leash%20agent%20event%20from%20ingress%20to%20decision.&descSize=18&descAlignY=58" width="100%" />

<p>
  <a href="https://openleash.com"><img src="https://img.shields.io/badge/Leash-openleash.com-06B6D4?style=for-the-badge&logo=googlechrome&logoColor=white" /></a>
  <a href="https://docs.openleash.com"><img src="https://img.shields.io/badge/Docs-docs.openleash.com-2563EB?style=for-the-badge&logo=readthedocs&logoColor=white" /></a>
  <img src="https://img.shields.io/badge/License-MIT-111827?style=for-the-badge&logo=opensourceinitiative&logoColor=white" />
</p>

<p>
  <img src="https://img.shields.io/badge/Node-%E2%89%A520-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Trace-NDJSON-22C55E?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Binding-loopback%20only-06B6D4?style=for-the-badge" />
</p>

<h3>🔭 One local timeline for hooks, proxy traffic, pullers, plugins, and policy.</h3>

</div>

---

## ✨ What this app is

`flow-viewer` is Leash's local pipeline observability app. It tails the
newline-delimited JSON trace emitted during development and turns it into a
searchable view of conversations, normalized stages, plugin execution, policy
decisions, and complete event payloads.

It is intentionally read-only. The viewer does not evaluate events, resolve
approvals, mutate policy, or act as a backend.

```text
API hook ───────────┐
local proxy ────────┼─► normalized pipeline trace ─► flow-viewer
provider puller ────┘            │
                                 ├─ conversation grouping
                                 ├─ stage-by-stage inspection
                                 └─ source and outcome filtering
```

---

## 🔥 What you can inspect

- Hook, local-proxy, and provider-puller ingress in one timeline
- Deduplication when multiple transports report the same agent action
- Agent, project, session, correlation, and idempotency metadata
- Normalization and plugin stages in execution order
- Allow, approval, deny, and in-progress outcomes
- Prompts, tools, summaries, policy results, and complete payloads
- Live conversation grouping with agent and source filters

The viewer displays what Leash received; it does not invent a second
session model or enforcement path.

---

## 🛠 Run locally

Requirements: Node.js 20 or newer and an Leash NDJSON pipeline trace.

```bash
npm install
OPENLEASH_PIPELINE_TRACE_FILE=/path/to/openleash-flow.ndjson npm start
```

Open [http://127.0.0.1:9340](http://127.0.0.1:9340).

From the Leash workspace, the recommended path is:

```bash
python3 run.py
```

Choose **Individual Open Source**. The mode runner enables tracing, starts this
app, and opens it alongside the local `client-api` and desktop client.

Run the standalone test suite with:

```bash
npm test
```

---

## ⚙️ Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENLEASH_PIPELINE_TRACE_FILE` | `./openleash-flow.ndjson` | Absolute or working-directory-relative NDJSON trace path. |
| `OPENLEASH_FLOW_VIEWER_HOST` | `127.0.0.1` | HTTP bind address. Keep loopback unless access is deliberately secured. |
| `OPENLEASH_FLOW_VIEWER_PORT` | `9340` | HTTP port; use `0` to select a free port in tests. |
| `OPENLEASH_FLOW_VIEWER_MAX_EVENTS` | `5000` | Maximum recent valid trace rows returned to the browser. |

Health check:

```bash
curl http://127.0.0.1:9340/healthz
```

---

## 🛡 Security notes

Pipeline traces may contain source code, prompts, tool inputs, model responses,
file paths, and other sensitive development context.

- The server binds to loopback by default.
- Responses disable caching and include a restrictive Content Security Policy.
- Invalid NDJSON rows are ignored rather than rendered.
- The app never uploads traces or calls Leash Cloud.
- Do not publish trace files, commit them, or bind the viewer to a shared
  interface without authentication and transport security.

See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.

<div align="center">

### Every transport. Every stage. One understandable flow.

</div>
