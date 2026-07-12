# OpenLeash local proxy

Cross-platform reverse proxy for Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses traffic. It reports normalized request and response events to `client-api`, reconstructs conversation/tool content, and applies an allowed prompt replacement before forwarding. It fails closed by default.

Normalized request events distinguish `UserPromptSubmit` from structured `PostToolUse` results. Tool-capable provider responses are bounded and held while Anthropic `tool_use`, Chat Completions `tool_calls`, and Responses API function/computer/shell/custom calls are reconstructed and synchronously evaluated as `PreToolUse`. Original bytes are released only after `allow`; denial or evaluator failure releases none of the tool call. Text-only response telemetry remains asynchronous.

Transport behavior follows the Headroom reference proxy in `other-apps/headroom-main`: non-LLM bodies and text-only model responses stream through a bounded tee, tool-capable HTTP/SSE responses use the synchronous gate above, hop-by-hop and connection-listed headers are stripped, OpenLeash internal headers never reach providers, WebSocket sessions are pumped bidirectionally, and redirects pass through.

Configure `OPENLEASH_PROXY_UPSTREAM`, `OPENLEASH_CLIENT_API`, and `OPENLEASH_TOKEN`. Set `OPENLEASH_CORPORATE_PROXY` to chain through an existing organization proxy. `OPENLEASH_PROXY_FAIL_OPEN=true` is an explicit operator override.

The proxy is asynchronous: waiting for a policy decision suspends only that request future and does not occupy a CPU thread. Intercepted requests are limited to 16 MiB with eight simultaneous request evaluations; gated responses are limited to 8 MiB each and eight simultaneous gates. Additional protected work waits with TCP backpressure while unrelated requests continue. Operators can tune `OPENLEASH_PROXY_MAX_BODY_BYTES`, `OPENLEASH_PROXY_MAX_CONCURRENT_REQUEST_EVALUATIONS`, `OPENLEASH_PROXY_MAX_GATED_RESPONSE_BYTES`, `OPENLEASH_PROXY_MAX_CONCURRENT_GATES`, and `OPENLEASH_PROXY_EVALUATION_TIMEOUT_SECONDS`. The gate defaults imply at most 64 MiB of raw held response data, plus bounded parser/runtime overhead.

The audited Headroom comparison and supported-invariant matrix is in `docs/LOCAL_PROXY_PARITY.md` at the repository root.
