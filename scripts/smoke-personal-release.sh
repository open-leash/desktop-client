#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-}"
PUBLISHED_IMAGE=0
if [[ "$IMAGE" =~ ^ghcr\.io/open-leash/client-api:[0-9]+\.[0-9]+\.[0-9]+@sha256:[a-f0-9]{64}$ ]]; then
  PUBLISHED_IMAGE=1
elif [[ "${OPENLEASH_RELEASE_SMOKE_ALLOW_UNPUBLISHED:-}" == "1" && "$IMAGE" =~ ^ghcr\.io/open-leash/client-api:[0-9]+\.[0-9]+\.[0-9]+-release-test$ ]]; then
  PUBLISHED_IMAGE=0
else
  printf '%s\n' "Usage: $0 ghcr.io/open-leash/client-api:VERSION@sha256:DIGEST" >&2
  exit 2
fi
command -v docker >/dev/null 2>&1 || { printf '%s\n' "Docker is required." >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_ID="${$}"
PROJECT="openleash-release-smoke-${SMOKE_ID}"
API_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
POSTGRES_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
VERSION_PIN="${IMAGE#ghcr.io/open-leash/client-api:}"
COMPOSE=(
  docker compose
  --project-name "$PROJECT"
  -f "$ROOT/deploy/docker/individual-open-source.compose.yml"
  -f "$ROOT/deploy/docker/release-smoke.override.yml"
)

cleanup() {
  "${COMPOSE[@]}" --profile setup down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

export OPENLEASH_SMOKE_ID="$SMOKE_ID"
export OPENLEASH_VERSION="$VERSION_PIN"
export OPENLEASH_CLIENT_API_PORT="$API_PORT"
export OPENLEASH_POSTGRES_PORT="$POSTGRES_PORT"
export OPENLEASH_DEV_TOKEN="release-smoke-token"

printf '%s\n' "[personal-release-smoke] pulling $IMAGE"
if [[ "$PUBLISHED_IMAGE" -eq 1 ]]; then
  docker pull "$IMAGE"
else
  docker image inspect "$IMAGE" >/dev/null
fi

printf '%s\n' "[personal-release-smoke] packaged Feature registry"
docker run --rm "$IMAGE" node --input-type=module -e '
  const registry = await import("/app/apps/engine/dist/plugins/registry.js");
  if (registry.firstPartyPluginManifests.length !== 8) {
    throw new Error(`Expected 8 built-in Features, found ${registry.firstPartyPluginManifests.length}`);
  }
  console.log("features=8");
'

printf '%s\n' "[personal-release-smoke] clean database migration, idempotency, and bootstrap"
"${COMPOSE[@]}" up -d --wait postgres
"${COMPOSE[@]}" --profile setup run --rm migrate
"${COMPOSE[@]}" --profile setup run --rm migrate
"${COMPOSE[@]}" --profile setup run --rm seed
"${COMPOSE[@]}" up -d --wait client-api

health="$(curl -fsS --max-time 10 "http://127.0.0.1:${API_PORT}/health")"
[[ "$health" == *'"ok":true'* ]] || {
  printf '%s\n' "Unexpected Personal Open Source health response: $health" >&2
  exit 1
}

printf '%s\n' "[personal-release-smoke] passed"
