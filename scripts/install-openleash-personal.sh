#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Leash"
INSTALL_DIR="/Applications"
DMG_SOURCE=""
RULES_FILE=""
REPLACE_RULES=0
NO_LAUNCH=0
QUIET=0
KEEP_SETTINGS=0
UNINSTALL=0
API_URL=""
USER_TOKEN=""
CLIENT_MODE=""
INSTALL_HOOKS=0
AGENTS=""
INDIVIDUAL_OPEN_SOURCE=0
OPENLEASH_BACKEND_DIR="${OPENLEASH_BACKEND_DIR:-$HOME/.openleash/individual-open-source}"
OPENLEASH_IMAGE_REGISTRY="${OPENLEASH_IMAGE_REGISTRY:-ghcr.io/open-leash}"
OPENLEASH_VERSION="${OPENLEASH_VERSION:-0.37.0@sha256:caa0f268c62e5cf2cf29076877a8b6ca3caf00ddedc8c5229e10df8c929661db}"

usage() {
  cat <<'EOF'
Leash personal installer

Usage:
  install-openleash-personal.sh [options]

Options:
  --dmg <path-or-url>       DMG to install. Defaults to a nearby Leash DMG.
  --target <directory>      Install directory. Defaults to /Applications.
  --rules <json>            Import rules after installation.
  --replace-rules           Replace existing rules when importing JSON.
  --api-url <url>           Personal Leash API endpoint. Defaults to Leash Cloud.
  --token <token>           Personal user token for scripted installs.
  --mode <mode>             personal, cloud, custom, or individual-open-source.
  --open-source             Install the local Personal Open Source backend.
  --backend-dir <path>      Local backend directory. Defaults to ~/.openleash/individual-open-source.
  --image-registry <host>   Docker image registry. Defaults to ghcr.io/open-leash.
  --version <tag[@digest]>  Docker image version for the local backend. Defaults to this release's verified digest.
  --install-hooks           Install supported local agent hooks after setup.
  --agents <list>           Comma-separated agent ids for hook installation.
  --keep-settings           Keep existing local Leash setup and history.
  --uninstall               Remove Leash, its local state, hooks, proxy configuration, and local backend.
  --no-launch               Install only; do not start Leash.
  --quiet                   Reduce installer output.
  --help                    Show this help.

Examples:
  ./install-openleash-personal.sh
  ./install-openleash-personal.sh --rules company-rules.json --replace-rules
  ./install-openleash-personal.sh --dmg https://example.com/Leash.dmg --quiet
EOF
}

log() {
  if [[ "$QUIET" -eq 0 ]]; then printf '%s\n' "$*" >&2; fi
}

die() {
  printf 'Leash install failed: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg)
      DMG_SOURCE="${2:-}"
      shift 2
      ;;
    --target)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --rules|--import-rules)
      RULES_FILE="${2:-}"
      shift 2
      ;;
    --replace-rules|--rules-replace)
      REPLACE_RULES=1
      shift
      ;;
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --token|--user-token)
      USER_TOKEN="${2:-}"
      shift 2
      ;;
    --mode)
      CLIENT_MODE="${2:-}"
      if [[ "$CLIENT_MODE" == "individual-open-source" || "$CLIENT_MODE" == "open-source" ]]; then
        INDIVIDUAL_OPEN_SOURCE=1
      fi
      shift 2
      ;;
    --open-source|--individual-open-source)
      INDIVIDUAL_OPEN_SOURCE=1
      CLIENT_MODE="individual-open-source"
      shift
      ;;
    --backend-dir)
      OPENLEASH_BACKEND_DIR="${2:-}"
      shift 2
      ;;
    --image-registry)
      OPENLEASH_IMAGE_REGISTRY="${2:-}"
      shift 2
      ;;
    --version)
      OPENLEASH_VERSION="${2:-}"
      shift 2
      ;;
    --install-hooks)
      INSTALL_HOOKS=1
      shift
      ;;
    --agents)
      AGENTS="${2:-}"
      shift 2
      ;;
    --keep-settings)
      KEEP_SETTINGS=1
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    --no-launch)
      NO_LAUNCH=1
      shift
      ;;
    --quiet)
      QUIET=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
MOUNT_POINT=""
cleanup() {
  if [[ -n "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

resolve_dmg() {
  if [[ -n "$DMG_SOURCE" ]]; then
    if [[ "$DMG_SOURCE" =~ ^https?:// ]]; then
      local downloaded="$TMP_DIR/Leash.dmg"
      log "Downloading Leash DMG..."
      curl -fL "$DMG_SOURCE" -o "$downloaded"
      printf '%s\n' "$downloaded"
      return
    fi
    [[ -f "$DMG_SOURCE" ]] || die "DMG not found: $DMG_SOURCE"
    printf '%s\n' "$DMG_SOURCE"
    return
  fi

  local nearby
  nearby="$(find "$SCRIPT_DIR" "$SCRIPT_DIR/.." "$PWD" "$PWD/release/personal" -maxdepth 2 -name 'Leash*.dmg' -type f 2>/dev/null | head -n 1 || true)"
  [[ -n "$nearby" ]] || die "No Leash DMG found. Pass --dmg <path-or-url>."
  printf '%s\n' "$nearby"
}

copy_app() {
  local source_app="$1"
  local target_app="$INSTALL_DIR/$APP_NAME.app"
  mkdir -p "$INSTALL_DIR" 2>/dev/null || true

  log "Installing $APP_NAME to $target_app..."
  if [[ -w "$INSTALL_DIR" ]]; then
    rm -rf "$target_app"
    ditto "$source_app" "$target_app"
    xattr -cr "$target_app" 2>/dev/null || true
    codesign --force --deep --sign - "$target_app" >/dev/null 2>&1 ||
      die "Could not apply the local macOS signature."
    codesign --verify --deep --strict "$target_app" >/dev/null 2>&1 ||
      die "The locally signed Leash app did not pass code-signature verification."
    xattr -cr "$target_app" 2>/dev/null || true
  else
    sudo rm -rf "$target_app"
    sudo ditto "$source_app" "$target_app"
    sudo xattr -cr "$target_app" 2>/dev/null || true
    sudo codesign --force --deep --sign - "$target_app" >/dev/null 2>&1 ||
      die "Could not apply the local macOS signature."
    sudo codesign --verify --deep --strict "$target_app" >/dev/null 2>&1 ||
      die "The locally signed Leash app did not pass code-signature verification."
    sudo xattr -cr "$target_app" 2>/dev/null || true
  fi
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$target_app" >/dev/null 2>&1 || true
  printf '%s\n' "$target_app"
}

stop_openleash() {
  if pgrep -f "/Leash.app/" >/dev/null 2>&1; then
    log "Stopping existing Leash..."
    pkill -TERM -f "/Leash.app/" || true
    sleep 1
    pkill -KILL -f "/Leash.app/" || true
  fi
}

remove_retired_feature_containers() {
  command -v docker >/dev/null 2>&1 || return
  log "Removing retired containerized Feature runtimes..."
  docker rm -f \
    openleash-plugin-gateway \
    openleash-plugin-dlp \
    openleash-plugin-sensitive-access \
    openleash-plugin-rules-enforcer \
    openleash-plugin-mcp-scanner \
    openleash-plugin-code-scanner \
    openleash-plugin-skill-scanner \
    openleash-plugin-siem-exporter \
    openleash-plugin-token-saver \
    openleash-plugin-blast-radius \
    >/dev/null 2>&1 || true
}

cleanup_existing_integrations() {
  local target_app="$1"
  local executable="$target_app/Contents/MacOS/$APP_NAME"
  [[ -x "$executable" ]] || die "Installed Leash executable was not found for integration cleanup."
  log "Removing existing Leash hooks and proxy configuration..."
  if ! env -u ELECTRON_RUN_AS_NODE "$executable" --cleanup-integrations >/dev/null; then
    die "Could not remove the previous Leash agent integrations. Agent configuration was not replaced."
  fi
}

uninstall_openleash() {
  local target_app="$INSTALL_DIR/$APP_NAME.app"
  local executable="$target_app/Contents/MacOS/$APP_NAME"
  stop_openleash
  if [[ -x "$executable" ]]; then
    cleanup_existing_integrations "$target_app"
  else
    die "Leash.app is required to safely restore agent configuration before uninstalling. Reinstall it, then rerun with --uninstall."
  fi

  if [[ -f "$OPENLEASH_BACKEND_DIR/docker-compose.yml" ]]; then
    local compose
    compose="$(docker_compose_cmd)"
    (cd "$OPENLEASH_BACKEND_DIR" && $compose down -v --remove-orphans)
  fi
  remove_retired_feature_containers

  log "Removing Leash application and local state..."
  if [[ -w "$INSTALL_DIR" ]]; then rm -rf "$target_app"; else sudo rm -rf "$target_app"; fi
  rm -rf \
    "$HOME/.openleash" \
    "$HOME/Library/Application Support/OpenLeash" \
    "$HOME/Library/Application Support/Leash" \
    "$HOME/Library/Logs/OpenLeash" \
    "$HOME/Library/Saved Application State/com.openleash.personal.savedState"
  rm -f /tmp/openleash-launch.log /tmp/openleash-startup.log
  log "Leash uninstalled. Agent hooks and proxy configuration were restored."
}

reset_settings() {
  if [[ "$KEEP_SETTINGS" -eq 1 ]]; then
    return
  fi
  log "Removing previous Leash local state for a clean installation..."
  if [[ -f "$OPENLEASH_BACKEND_DIR/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
    local compose
    compose="$(docker_compose_cmd)"
    (cd "$OPENLEASH_BACKEND_DIR" && $compose down -v --remove-orphans) || true
  fi
  rm -rf \
    "$HOME/.openleash" \
    "$HOME/Library/Application Support/Leash" \
    "$HOME/Library/Application Support/OpenLeash" \
    "$HOME/Library/Logs/Leash" \
    "$HOME/Library/Logs/OpenLeash" \
    "$HOME/Library/WebKit/leash-island" \
    "$HOME/Library/WebKit/openleash-island" \
    "$HOME/Library/Caches/leash-island" \
    "$HOME/Library/Caches/openleash-island" \
    "$HOME/Library/Saved Application State/com.openleash.personal.savedState" \
    "$HOME/Library/Saved Application State/com.openleash.openleash.savedState"
}

docker_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    printf 'docker-compose'
    return
  fi
  die "Docker Compose was not found. Install Docker Desktop, Colima with Docker Compose, or OrbStack, then rerun with --open-source."
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    uuidgen | tr -d '-' | tr '[:upper:]' '[:lower:]'
  fi
}

write_individual_open_source_runtime() {
  mkdir -p "$OPENLEASH_BACKEND_DIR/backups"
  if [[ ! -f "$OPENLEASH_BACKEND_DIR/.env" ]]; then
    cat > "$OPENLEASH_BACKEND_DIR/.env" <<EOF
OPENLEASH_IMAGE_REGISTRY=$OPENLEASH_IMAGE_REGISTRY
OPENLEASH_VERSION=$OPENLEASH_VERSION
OPENLEASH_POSTGRES_DB=openleash
OPENLEASH_POSTGRES_USER=openleash
OPENLEASH_POSTGRES_PASSWORD=$(random_secret)
OPENLEASH_CLIENT_API_PORT=9318
OPENLEASH_RELEASE_ADMIN_TOKEN=$(random_secret)
OPENLEASH_MODEL_KEY_ENCRYPTION_KEY=$(random_secret)
OPENLEASH_PROVIDER_USAGE_ENCRYPTION_KEY=$(random_secret)
OPENLEASH_SECRET_KEY=$(random_secret)
OPENLEASH_DEV_TOKEN=
OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED=1
OPENLEASH_DEV_ORG_SLUG=individual-open-source
OPENLEASH_DEV_ORG_NAME=Individual Open Source
EOF
  else
    if ! grep -q '^OPENLEASH_IMAGE_REGISTRY=' "$OPENLEASH_BACKEND_DIR/.env"; then
      printf '\nOPENLEASH_IMAGE_REGISTRY=%s\n' "$OPENLEASH_IMAGE_REGISTRY" >> "$OPENLEASH_BACKEND_DIR/.env"
    fi
    if grep -q '^OPENLEASH_VERSION=' "$OPENLEASH_BACKEND_DIR/.env"; then
      sed -i.bak "s/^OPENLEASH_VERSION=.*/OPENLEASH_VERSION=$OPENLEASH_VERSION/" "$OPENLEASH_BACKEND_DIR/.env" && rm -f "$OPENLEASH_BACKEND_DIR/.env.bak"
    else
      printf 'OPENLEASH_VERSION=%s\n' "$OPENLEASH_VERSION" >> "$OPENLEASH_BACKEND_DIR/.env"
    fi
  fi

  cat > "$OPENLEASH_BACKEND_DIR/docker-compose.yml" <<'EOF'
name: openleash-individual

services:
  postgres:
    image: postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
    container_name: openleash-individual-postgres
    environment:
      POSTGRES_DB: ${OPENLEASH_POSTGRES_DB:-openleash}
      POSTGRES_USER: ${OPENLEASH_POSTGRES_USER:-openleash}
      POSTGRES_PASSWORD: ${OPENLEASH_POSTGRES_PASSWORD:-openleash}
    volumes:
      - openleash-individual-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${OPENLEASH_POSTGRES_USER:-openleash} -d ${OPENLEASH_POSTGRES_DB:-openleash}"]
      interval: 5s
      timeout: 5s
      retries: 20

  migrate:
    image: ${OPENLEASH_IMAGE_REGISTRY:-ghcr.io/open-leash}/client-api:${OPENLEASH_VERSION:-0.37.0@sha256:caa0f268c62e5cf2cf29076877a8b6ca3caf00ddedc8c5229e10df8c929661db}
    profiles: ["setup"]
    environment:
      DATABASE_URL: postgres://${OPENLEASH_POSTGRES_USER:-openleash}:${OPENLEASH_POSTGRES_PASSWORD:-openleash}@postgres:5432/${OPENLEASH_POSTGRES_DB:-openleash}
      OPENLEASH_DEV_TOKEN: ${OPENLEASH_DEV_TOKEN:-}
      OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED: ${OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED:-1}
      OPENLEASH_DEV_ORG_SLUG: individual-open-source
      OPENLEASH_DEV_ORG_NAME: Individual Open Source
      OPENLEASH_DEPLOYMENT_MODE: individual-open-source
    command: ["node", "apps/client-api/dist/migrate.js", "--apply"]
    depends_on:
      postgres:
        condition: service_healthy

  seed:
    image: ${OPENLEASH_IMAGE_REGISTRY:-ghcr.io/open-leash}/client-api:${OPENLEASH_VERSION:-0.37.0@sha256:caa0f268c62e5cf2cf29076877a8b6ca3caf00ddedc8c5229e10df8c929661db}
    profiles: ["setup"]
    environment:
      DATABASE_URL: postgres://${OPENLEASH_POSTGRES_USER:-openleash}:${OPENLEASH_POSTGRES_PASSWORD:-openleash}@postgres:5432/${OPENLEASH_POSTGRES_DB:-openleash}
    command: ["node", "apps/client-api/dist/bootstrap-personal.js", "--name", "Individual Open Source", "--slug", "individual-open-source", "--mode", "private"]
    depends_on:
      postgres:
        condition: service_healthy

  client-api:
    image: ${OPENLEASH_IMAGE_REGISTRY:-ghcr.io/open-leash}/client-api:${OPENLEASH_VERSION:-0.37.0@sha256:caa0f268c62e5cf2cf29076877a8b6ca3caf00ddedc8c5229e10df8c929661db}
    container_name: openleash-individual-client-api
    environment:
      DATABASE_URL: postgres://${OPENLEASH_POSTGRES_USER:-openleash}:${OPENLEASH_POSTGRES_PASSWORD:-openleash}@postgres:5432/${OPENLEASH_POSTGRES_DB:-openleash}
      OPENLEASH_API_PORT: 9318
      OPENLEASH_API_SURFACE: client
      OPENLEASH_DEPLOYMENT_MODE: individual-open-source
      OPENLEASH_DEV_ORG_SLUG: individual-open-source
      OPENLEASH_DEV_ORG_NAME: Individual Open Source
      OPENLEASH_DEV_TOKEN: ${OPENLEASH_DEV_TOKEN:-}
      OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED: ${OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED:-1}
      OPENLEASH_RELEASE_ADMIN_TOKEN: ${OPENLEASH_RELEASE_ADMIN_TOKEN:-local-release-admin-token}
      OPENLEASH_MODEL_KEY_ENCRYPTION_KEY: ${OPENLEASH_MODEL_KEY_ENCRYPTION_KEY:-openleash-local-model-key-change-me}
      OPENLEASH_PROVIDER_USAGE_ENCRYPTION_KEY: ${OPENLEASH_PROVIDER_USAGE_ENCRYPTION_KEY:-openleash-local-provider-key-change-me}
      OPENLEASH_SECRET_KEY: ${OPENLEASH_SECRET_KEY:-openleash-local-secret-change-me}
    ports:
      - "127.0.0.1:${OPENLEASH_CLIENT_API_PORT:-9318}:9318"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  openleash-individual-postgres:
EOF
}

install_individual_open_source_backend() {
  command -v docker >/dev/null 2>&1 || die "Docker was not found. Install Docker Desktop, Colima, or OrbStack, then rerun with --open-source."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker, then rerun with --open-source."
  local compose
  compose="$(docker_compose_cmd)"
  write_individual_open_source_runtime
  log "Starting Leash Personal Open Source backend in $OPENLEASH_BACKEND_DIR..."
  (cd "$OPENLEASH_BACKEND_DIR" && $compose --profile setup pull)
  (cd "$OPENLEASH_BACKEND_DIR" && $compose up -d postgres)
  (cd "$OPENLEASH_BACKEND_DIR" && $compose --profile setup run --rm migrate)
  (cd "$OPENLEASH_BACKEND_DIR" && $compose --profile setup run --rm seed)
  (cd "$OPENLEASH_BACKEND_DIR" && $compose up -d client-api)
  API_URL="http://127.0.0.1:9318"
  local ready=0
  for _ in $(seq 1 90); do
    if curl -fsS "$API_URL/health" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  if [[ "$ready" -ne 1 ]]; then
    (cd "$OPENLEASH_BACKEND_DIR" && $compose logs --tail=100 client-api) >&2 || true
    die "Leash Personal Open Source backend did not become healthy within 180 seconds."
  fi
  CLIENT_MODE="custom"
}

if [[ "$UNINSTALL" -eq 1 ]]; then
  uninstall_openleash
  exit 0
fi

# The updater always passes --keep-settings. If this installation already has
# the Personal Open Source backend, upgrade that backend in place as part of the
# same update: pull the release image, apply migrations, seed idempotently, and
# restart the client API. A normal install intentionally starts with no backend
# or desktop state.
if [[ "$KEEP_SETTINGS" -eq 1 && -f "$OPENLEASH_BACKEND_DIR/docker-compose.yml" ]]; then
  INDIVIDUAL_OPEN_SOURCE=1
  CLIENT_MODE="custom"
fi

DMG_PATH="$(resolve_dmg)"
[[ -z "$RULES_FILE" || -f "$RULES_FILE" ]] || die "Rules JSON not found: $RULES_FILE"

HAD_EXISTING_LOCAL_STATE=0
if [[ -d "$HOME/Library/Application Support/Leash" || -d "$HOME/Library/Application Support/OpenLeash" ]]; then
  HAD_EXISTING_LOCAL_STATE=1
fi

stop_openleash
remove_retired_feature_containers

MOUNT_POINT="$TMP_DIR/mount"
mkdir -p "$MOUNT_POINT"
log "Mounting $DMG_PATH..."
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse -quiet

SOURCE_APP="$(find "$MOUNT_POINT" -maxdepth 2 -name "$APP_NAME.app" -type d | head -n 1 || true)"
[[ -n "$SOURCE_APP" ]] || die "$APP_NAME.app not found in DMG."

TARGET_APP="$(copy_app "$SOURCE_APP")"
if [[ "$HAD_EXISTING_LOCAL_STATE" -eq 1 ]]; then
  cleanup_existing_integrations "$TARGET_APP"
fi
reset_settings

if [[ "$INDIVIDUAL_OPEN_SOURCE" -eq 1 ]]; then
  install_individual_open_source_backend
fi

if [[ "$NO_LAUNCH" -eq 0 ]]; then
  args=()
  if [[ "$KEEP_SETTINGS" -eq 1 ]]; then
    args+=(--keep-settings)
  else
    args+=(--fresh-install)
  fi
  if [[ -n "$RULES_FILE" ]]; then
    args+=(--import-rules "$RULES_FILE")
    if [[ "$REPLACE_RULES" -eq 1 ]]; then args+=(--replace-rules); fi
  fi
  if [[ -n "$API_URL" ]]; then args+=(--api-url "$API_URL"); fi
  if [[ -n "$USER_TOKEN" ]]; then args+=(--token "$USER_TOKEN"); fi
  if [[ -n "$CLIENT_MODE" ]]; then args+=(--mode "$CLIENT_MODE"); fi
  if [[ "$INSTALL_HOOKS" -eq 1 ]]; then args+=(--install-hooks); fi
  if [[ -n "$AGENTS" ]]; then args+=(--agents "$AGENTS"); fi
  log "Starting $APP_NAME..."
  app_executable="$TARGET_APP/Contents/MacOS/$APP_NAME"
  if [[ -x "$app_executable" ]]; then
    if [[ "${#args[@]}" -gt 0 ]]; then
      nohup env -u ELECTRON_RUN_AS_NODE "$app_executable" "${args[@]}" >/tmp/openleash-launch.log 2>&1 &
    else
      nohup env -u ELECTRON_RUN_AS_NODE "$app_executable" >/tmp/openleash-launch.log 2>&1 &
    fi
  else
    if [[ "${#args[@]}" -gt 0 ]]; then
      open "$TARGET_APP" --args "${args[@]}"
    else
      open "$TARGET_APP"
    fi
  fi
fi

log "Leash installed."
