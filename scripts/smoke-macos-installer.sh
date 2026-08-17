#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' "[installer-smoke] skipped: macOS is required"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${2:-$ROOT/scripts/install-openleash-personal.sh}"
DMG="${1:-}"
if [[ -z "$DMG" ]]; then
  DMG="$(find "$ROOT/release/personal" "$ROOT/apps/desktop-client/release/macos" -maxdepth 1 -type f -name 'Leash-*-arm64.dmg' -print 2>/dev/null | sort -V | tail -n 1)"
fi
[[ -x "$INSTALLER" ]] || { printf '%s\n' "Installer is not executable: $INSTALLER" >&2; exit 1; }
[[ -f "$DMG" ]] || { printf '%s\n' "DMG was not found: $DMG" >&2; exit 1; }

SMOKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/leash-installer-smoke.XXXXXX")"
case "$SMOKE_ROOT" in
  */leash-installer-smoke.*) ;;
  *) printf '%s\n' "Unsafe smoke-test directory: $SMOKE_ROOT" >&2; exit 1 ;;
esac
SMOKE_PID=""

cleanup() {
  if [[ -n "$SMOKE_PID" ]] && kill -0 "$SMOKE_PID" 2>/dev/null; then
    kill -KILL "$SMOKE_PID" 2>/dev/null || true
  fi
  chflags -R nouchg,noschg "$SMOKE_ROOT" >/dev/null 2>&1 || true
  chmod -RN "$SMOKE_ROOT" >/dev/null 2>&1 || true
  chmod -R u+rwX "$SMOKE_ROOT" >/dev/null 2>&1 || true
  rm -rf -- "$SMOKE_ROOT"
}
trap cleanup EXIT

SMOKE_HOME="$SMOKE_ROOT/home"
INSTALL_DIR="$SMOKE_ROOT/Applications"
mkdir -p "$SMOKE_HOME" "$INSTALL_DIR"

printf '%s\n' "[installer-smoke] fresh install"
HOME="$SMOKE_HOME" "$INSTALLER" --dmg "$DMG" --target "$INSTALL_DIR" --no-launch
APP="$INSTALL_DIR/Leash.app"
EXECUTABLE="$APP/Contents/MacOS/Leash"
[[ -x "$EXECUTABLE" ]]
codesign --verify --deep --strict "$APP"

printf '%s\n' "[installer-smoke] packaged runtime"
ELECTRON_RUN_AS_NODE=1 "$EXECUTABLE" -e '
  const fs = require("node:fs");
  const resources = process.argv[1];
  const roots = [
    `${resources}/app.asar/dist`,
    `${resources}/app.asar/apps/desktop-client/dist`,
  ];
  const base = roots.find((candidate) => fs.existsSync(`${candidate}/plugin-catalog.js`));
  if (!base) throw new Error("Packaged desktop modules are missing.");
  const catalog = require(`${base}/plugin-catalog.js`);
  const features = catalog.bundledFirstPartyPlugins;
  if (!Array.isArray(features) || features.length !== 8)
    throw new Error(`Expected 8 built-in Features, found ${features?.length ?? "none"}.`);
  require.resolve("@openleash/shared", { paths: [base] });
  console.log("packaged-runtime-ok");
' "$APP/Contents/Resources"

printf '%s\n' "[installer-smoke] running, read-only upgrade"
mkdir -p "$SMOKE_HOME/Library/Application Support/Leash"
ELECTRON_RUN_AS_NODE=1 "$EXECUTABLE" -e 'setInterval(() => {}, 1000)' &
SMOKE_PID=$!
sleep 0.5
kill -0 "$SMOKE_PID"
chmod -R a-w "$APP"
HOME="$SMOKE_HOME" "$INSTALLER" --dmg "$DMG" --target "$INSTALL_DIR" --keep-settings --no-launch
if kill -0 "$SMOKE_PID" 2>/dev/null; then
  printf '%s\n' "Installer did not stop the running previous app." >&2
  exit 1
fi
SMOKE_PID=""

[[ -x "$EXECUTABLE" ]]
codesign --verify --deep --strict "$APP"
if find "$INSTALL_DIR" -maxdepth 1 \( -name '.Leash.app.installing.*' -o -name '.Leash.app.previous.*' \) -print -quit | grep -q .; then
  printf '%s\n' "Installer left a staging or backup bundle behind." >&2
  exit 1
fi

printf '%s\n' "[installer-smoke] passed"
