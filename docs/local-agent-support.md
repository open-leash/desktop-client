# Adding Local Agent Support

Leash keeps local agent support in one registry:

`apps/desktop-client/src/agent-registry.ts`

The shared Client CLI lives in:

`apps/desktop-client/src/cli/hook.ts`

Current protectable agents:

- Claude Code: Claude-compatible command hooks in `~/.claude/settings.json`
- OpenAI Codex: Codex hook file in `~/.codex/hooks.json` plus approval handoff in `~/.codex/config.toml`
- GitHub Copilot: user-level hooks in `~/.copilot/hooks/openleash.json`, or `$COPILOT_HOME/hooks/openleash.json` when `COPILOT_HOME` is set
- Cursor: hook file in `~/.cursor/hooks.json`
- Gemini CLI: hook entries in `~/.gemini/settings.json`
- OpenCode: Leash plugin in `~/.config/opencode/plugins/openleash.js`
- OpenClaw: managed internal hook in `~/.openclaw/hooks/openleash/`
- NanoClaw: Claude-compatible command hooks in `~/.nanoclaw/settings.json`

Current detection-only agents include Cline, Continue, and Windsurf. They appear in the app only when detected locally, but remain disabled until a native protection contract is implemented.

## Full-conversation proxy support

Hooks and proxying are independent controls and may be enabled together. The desktop package includes the native Rust proxy and runs it directly on `127.0.0.1:9320`. Personal and Business Cloud users do not need Docker for proxy protection.

Desktop setup treats monitoring as one lifecycle. For every selected agent it installs the native API hooks, starts the bundled proxy, and applies a reversible proxy adapter when that agent exposes a safe automatic base-URL configuration. Turning monitoring off restores that agent's pre-Leash proxy configuration and removes its hooks; turning it back on reinstalls both. Removing desktop settings or running a full local cleanup restores all managed agent files before stopping the proxy process.

- Claude CLI and the Claude Code VS Code extension are configured through `ANTHROPIC_BASE_URL` in their shared `~/.claude/settings.json`.
- Codex CLI and the Codex VS Code extension are configured with an Leash Responses API provider in their shared `~/.codex/config.toml`.
- NanoClaw uses its Claude-compatible `~/.nanoclaw/settings.json` base URL.
- OpenCode CLI/desktop uses the documented Anthropic and OpenAI `provider.*.options.baseURL` keys in `~/.config/opencode/opencode.json`. An existing JSONC file is never destructively rewritten; the UI reports the exact manual keys instead.
- Every automatic adapter creates a byte-for-byte backup before changing configuration and restores it during uninstall. Reinstall first runs that restoration and then writes a fresh adapter, so an older Leash block can never become the new backup. If backup metadata is missing, cleanup removes only exact Leash-managed URLs/blocks and preserves unrelated user configuration.
- The desktop watchdog repairs managed proxy configuration while the proxy is enabled.
- Existing organization proxy infrastructure is supported through the `--corporate-proxy` CLI option.
- Desktop builds compile the Rust proxy and bundle the platform-native executable inside Leash. `python3 run.py --cleanup-local` stops the managed proxy process, restores agent configuration, stops `flow-viewer`, and removes the remaining local stack. Cleanup also removes a legacy proxy container when an older Leash installation created one and Docker happens to be available.
- Individual Open Source runs enable a redacted end-to-end flow trace at `output/openleash-flow.ndjson` and start the local `flow-viewer` at `http://127.0.0.1:9340`. Option 1 opens the web app automatically; reopen it anytime with `python3 run.py --view-flow`. Pass `--no-open-flow-viewer` to suppress automatic browser opening while keeping the server available. The viewer groups traffic by agent and conversation, shows raw hook/proxy ingress, normalized envelopes, plugin runs, deduplication, final allow/ask/deny outcomes, and expandable complete payloads. Prompt, transcript, and tool content remain visible; authorization, token, key, password, cookie, and secret-named fields are redacted.
- In Individual Open Source mode, `local-proxy` is authoritative for prompt evaluation on Claude Code, Codex, OpenCode, and NanoClaw. Their `UserPromptSubmit` hooks return immediately with a traced handoff and do not persist/evaluate a competing prompt event. This lets the provider-bound local-proxy request run token-saver, DLP, prompt rewriting, and policy evaluation before release. Hook-only agents retain normal hook evaluation, and pre-tool hooks remain the final enforcement point immediately before execution.
- Plugin evaluation uses bounded async concurrency for the built-in independent policy plugins: sensitive-access, blast-radius, rules-enforcer, and MCP scanning start together and are reassembled in deterministic configured order. For prompts, this policy batch overlaps the prompt-transform chain. Token-saver and DLP intentionally remain sequential because DLP must inspect the actual transformed prompt that would be released. A failure in any required branch still fails the joined evaluation closed.

Each automatically configured surface uses an `/agent/:kind` proxy prefix. The proxy removes that local-only prefix before forwarding and records the correct agent identity in normalized events, so CLI and editor traffic are attributed consistently.

| Agent surface                | Proxy setup                                                                                                             | Protection fallback     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Claude CLI / Claude VS Code  | Automatic                                                                                                               | Claude hooks            |
| Codex CLI / Codex VS Code    | Automatic                                                                                                               | Codex hooks             |
| OpenCode CLI / desktop       | Automatic for strict JSON; guided for JSONC                                                                             | OpenCode plugin         |
| NanoClaw                     | Automatic                                                                                                               | Claude-compatible hooks |
| Cursor                       | Guided: set OpenAI override to `http://127.0.0.1:9320/v1` and Anthropic to `http://127.0.0.1:9320` in Settings > Models | Cursor hooks            |
| Cline                        | Guided: choose OpenAI Compatible and set Base URL to `http://127.0.0.1:9320/v1`                                         | Detection only          |
| GitHub Copilot CLI / VS Code | Not persisted: Copilot provider routing is launch-environment scoped                                                    | Copilot hooks           |
| OpenClaw                     | Requires an OpenClaw runtime plugin because resolved provider URLs live in memory                                       | OpenClaw hook pack      |

“Guided” and “runtime plugin” are intentional capability boundaries, not guessed config writes. Leash does not modify undocumented settings merely to make a proxy toggle appear automatic.

GitHub Copilot notes:

- Copilot CLI loads user-level hooks from `~/.copilot/hooks/*.json` on macOS/Linux, `%USERPROFILE%\.copilot\hooks\*.json` on Windows, or `$COPILOT_HOME/hooks/*.json` when `COPILOT_HOME` is set.
- Copilot cloud agent only loads repository-level `.github/hooks/*.json` from the default branch. User-level hooks are local CLI only.
- Leash uses PascalCase events such as `PreToolUse` so Copilot applies the Claude-compatible matcher semantics documented by GitHub.
- In Copilot cloud agent, `ask` decisions are treated as `deny` because no user is available in the sandbox. Leash org policy should use `block` for cloud Copilot enforcement and `ask` only where a client can answer.

The desktop client is not a standalone policy engine. Installed hooks call Leash Cloud, or the local `client-api` when the user chose Personal Open Source. The desktop local API remains available for setup, tray state, OAuth callbacks, local development, local cache, and compatibility relay behavior. If the configured backend is unavailable, protected hooks fail closed.

To add a new agent, add an `AgentDefinition` with:

- `kind`: stable machine id, for example `my-agent`
- `displayName`: human name shown in the app
- `icon`: matching SVG name in `apps/desktop-client/src/agent-icons`
- `detect`: returns whether the agent is installed and protected
- `install`: optional setup function that writes the agent's approval/protection config

Agents without an `install` function can still be detected, but the setup wizard will not let users enable them until protection is actually implemented.

## Minimal Detection-Only Agent

```ts
{
  kind: "my-agent",
  displayName: "My Agent",
  icon: "my-agent",
  detect: () => detectGenericAgent({
    kind: "my-agent",
    displayName: "My Agent",
    icon: "my-agent",
    binaries: ["my-agent"],
    configPaths: [".my-agent"]
  })
}
```

## Fully Protectable Agent

```ts
{
  kind: "my-agent",
  displayName: "My Agent",
  icon: "my-agent",
  detect: detectMyAgentProtection,
  install: installMyAgentProtection
}
```

Detection should be conservative: only report `protected: true` when the installed local config clearly points to Leash-owned HTTP hook endpoints or the legacy Leash hook runtime.

Installers should preserve existing user config, add only Leash-owned entries, and avoid deleting unrelated settings.

For agents with Claude-style hooks, use the HTTP endpoint command shape:

```sh
curl -sS --fail-with-body \
  -X POST 'https://api.openleash.com/v1/hooks/my-agent/UserPromptSubmit?user_token=...' \
  -H 'content-type: application/json' \
  --data-binary @-
```

For agents with their own hook package format, install a native adapter that posts the raw hook payload to `/v1/hooks/:agent/:event` and returns that agent's expected allow/deny response format.
