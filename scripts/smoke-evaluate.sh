#!/usr/bin/env bash
set -euo pipefail

curl -sS "${OPENLEASH_CLIENT_API_URL:-http://localhost:9318}/v1/evaluate" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${OPENLEASH_DEV_TOKEN:?Set OPENLEASH_DEV_TOKEN for the local client API before running this smoke test.}" \
  -d '{
    "computer": {"hostname":"dev-mac","platform":"darwin","osRelease":"test"},
    "agent": {"kind":"claude-code","displayName":"Claude Code"},
    "event": {
      "eventName":"PreToolUse",
      "agentKind":"claude-code",
      "sessionId":"smoke",
      "projectPath":"/tmp/openleash",
      "tool":{"name":"Read","input":{"file_path":".env"}},
      "occurredAt":"2026-05-10T00:00:00.000Z"
    }
  }' | jq
