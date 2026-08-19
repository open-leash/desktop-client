# Local Proxy Parity Contract

This document records the audit against `other-apps/headroom-main/crates/headroom-proxy`. “Parity” means matching the transport invariant where it applies to Leash; Headroom-specific compression algorithms are intentionally replaced by Leash’s capability-aware plugin processor.

## README proxy feature decomposition

The Headroom README mixes library, MCP, memory, learning, compression, and proxy product features. Only these proxy concerns belong in Leash’s proxy parity contract:

- drop-in local HTTP gateway and agent-specific base-URL wrapping;
- Anthropic Messages, OpenAI Chat Completions, OpenAI Responses, Conversations passthrough, SSE, and WebSocket transport;
- full prompt/conversation/tool-call/tool-result interception;
- byte-preserving passthrough when policy does not transform a prompt;
- provider header/auth/query preservation, request correlation, bounded bodies, timeouts, redirects, corporate proxy chaining, health, metrics, and graceful shutdown;
- correct provider/agent attribution and normalized pipeline delivery;
- reversible agent setup and a persistent cross-platform runtime.

Headroom’s compressors, CCR retrieval cache, cache-key/tool-schema stabilization, output shaping, memory, MCP tools, and learning system are product algorithms rather than reverse-proxy transport behavior. Leash routes transformations through its plugin pipeline instead of silently copying those policies into the transport.

| Concern                             | Leash contract                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP methods, status, query strings | Passed through verbatim; tested against a mock upstream.                                                                                                                                                                                                                       |
| URL prefix joining                  | Preserves upstream path prefixes and query strings without duplicating `/v1`; unit tested.                                                                                                                                                                                     |
| Unchanged model requests            | Exact original bytes are forwarded. JSON is serialized only after an actual plugin rewrite; integration tested.                                                                                                                                                                |
| Body limits                         | Configurable request and independently bounded gated-response limits, with `Content-Length` precheck and loud `413`; integration tested.                                                                                                                                       |
| Non-model bodies                    | Streamed without buffering.                                                                                                                                                                                                                                                    |
| Response streaming                  | Text-only traffic uses a bounded asynchronous tee with backpressure. Tool-capable responses are held until complete tool calls receive a synchronous final decision; blocked tool bytes are never released.                                                                    |
| SSE framing                         | Supports LF/CRLF, comments, `[DONE]`, multi-`data:` events, split transport chunks after bounded reassembly, Anthropic deltas, Chat Completions deltas, and Responses deltas; unit tested.                                                                                     |
| WebSockets                          | Bidirectional text/binary/ping/pong/close pump with provider headers and TLS; compiled and unit-covered conversion paths.                                                                                                                                                      |
| Headers                             | Drops standard hop-by-hop headers, headers named by `Connection`, `Host`, `Content-Length`, and internal `x-openleash-*`; filters both directions.                                                                                                                             |
| Request IDs                         | Preserves caller `x-request-id` or creates one, forwards it upstream, and returns it downstream.                                                                                                                                                                               |
| Corporate proxies                   | `OPENLEASH_CORPORATE_PROXY` uses the HTTP client’s standard HTTP/HTTPS proxy support.                                                                                                                                                                                          |
| Failure behavior                    | Leash policy evaluation fails closed by default; explicit fail-open is an operator choice. Upstream errors/status codes pass through.                                                                                                                                      |
| Timeouts                            | Independent configurable connect, upstream, and synchronous evaluation timeouts. A gate timeout fails closed by default without releasing provider bytes.                                                                                                                      |
| Shutdown                            | Handles Ctrl-C and SIGTERM and drains Axum gracefully.                                                                                                                                                                                                                         |
| Health                              | Process health and separate upstream reachability endpoints.                                                                                                                                                                                                                   |
| Metrics                             | Prometheus-text request/error/gate counters plus gate capacity and in-flight gauges.                                                                                                                                                                                           |
| Capture bounds                      | Response telemetry is bounded independently from request limits.                                                                                                                                                                                                               |
| Protocol normalization              | Anthropic Messages, OpenAI Chat Completions, OpenAI Responses items, tool calls/results, and Vertex publisher paths.                                                                                                                                                           |
| Tool event normalization            | Latest tool results become structured `PostToolUse` events; provider tool calls become structured `PreToolUse` observations with `tool.name`, `input`, or `output`, while full transcripts remain attached.                                                                    |
| Concurrent approvals                | Separate async semaphores bound simultaneous request evaluations and held responses (eight each by default); queued work applies TCP backpressure without occupying CPU threads. Unrelated requests continue. Delay, timeout, failure, and concurrency are integration tested. |
| Response reporting                  | Completed JSON/SSE responses become normalized `local_proxy` events asynchronously.                                                                                                                                                                                            |

## Deliberate product differences

Headroom’s live-zone compressor, auth-mode compression policy, tool/schema sorting, prompt-cache-key synthesis, cache drift detector, and compression metrics implement Headroom’s compression product. Leash must not run a second hidden compression policy in the proxy. Leash invokes the configured DLP/token-saver plugins synchronously through `client-api`; unchanged requests retain byte equality.

Headroom’s native AWS Bedrock SigV4/EventStream and Vertex ADC credential acquisition are provider credential adapters, not generic reverse-proxy behavior. Leash currently configures Claude Code through the Anthropic HTTP protocol and Codex through the OpenAI Responses protocol. Vertex bearer-auth publisher routes can be forwarded with `OPENLEASH_VERTEX_UPSTREAM`. Native Bedrock interception must not be presented as supported until Leash adds an explicit AWS credential/signing adapter and a desktop agent configuration that can safely select it.

The parity contract is guarded by Rust unit tests, `scripts/test-local-proxy.mjs`, native desktop packaging checks, optional container builds, Clippy with warnings denied, and the repository product/deployment smoke suites.

## Platform and real-agent verification

- The proxy binary uses Rust/Axum/Tokio without Unix-only request-path behavior. Ctrl-C works everywhere; SIGTERM draining is additionally enabled on Unix.
- The desktop-bundled native proxy binds to loopback only and talks directly to the configured `client-api`. It does not require Docker Desktop or Docker Engine.
- Home-directory adapters use Node platform paths and reversible backups. The packaged Rust executable is the supported customer runtime on macOS and Windows; container packaging remains available for infrastructure use.
- `scripts/test-installed-agents-through-proxy.mjs` launches installed Claude, Codex, and OpenCode CLIs against controlled local provider simulators. It requires every launched agent to traverse the real Rust proxy and produce correctly attributed normalized events, without using provider credentials or changing persistent agent configuration.
- `OPENLEASH_SMOKE_REAL_PLUGIN_AGENTS=1 node scripts/smoke-product-logic.mjs` runs those installed CLIs through the real Rust proxy, real `client-api`, Postgres, and core plugin runtime. It verifies Claude DLP denial with zero protected-prompt provider delivery, OpenCode token-saver rewriting with marker preservation, Codex sensitive-access denial, persisted plugin run IDs/statuses, and Claude sensitive-access approval in both human allow and deny branches. Concurrent duplicate packets are coalesced onto one in-flight evaluation.
- OpenClaw is exercised through its hook pack today. Full provider interception remains dependent on an OpenClaw runtime plugin because OpenClaw resolves several provider URLs in gateway memory; writing guessed persistent URLs would be unsafe.
