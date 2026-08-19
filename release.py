#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from schema_tools import CLIENTS, client_target, env_value


ROOT = Path(__file__).resolve().parent
APP_REPOS = [
    ROOT / "apps" / "client-api",
    ROOT / "apps" / "desktop-client",
    ROOT / "apps" / "docs-web",
    ROOT / "apps" / "flow-viewer",
    ROOT / "apps" / "local-proxy",
    ROOT / "apps" / "main-web",
    ROOT / "apps" / "mobile-client",
    ROOT / "packages" / "shared",
]
PRIVATE_REPOS: list[Path] = []
PLUGIN_REPOS: list[Path] = []
POSTGRES_MIGRATIONS = ROOT / "infra" / "postgres" / "migrations"
CLIENT_API_POSTGRES_SCHEMA = ROOT / "apps" / "client-api" / "infra" / "postgres" / "schema.sql"
CLIENT_API_POSTGRES_MIGRATIONS = ROOT / "apps" / "client-api" / "infra" / "postgres" / "migrations"
POSTGRES_SCHEMA = CLIENT_API_POSTGRES_SCHEMA
RELEASE_NOTES = ROOT / "release-notes"

APP_TO_SNAPSHOT = {
    "apps/client-api": ["client-api"],
    "apps/desktop-client": ["desktop-client"],
    "apps/mobile-client": [],
}
POSTGRES_APPS = {
    "apps/client-api",
}
PRODUCTION_MOBILE_API_URL = os.environ.get("OPENLEASH_RELEASE_MOBILE_API_URL", "https://api.openleash.com")
DEFAULT_DESKTOP_DOWNLOAD_HOST = os.environ.get("OPENLEASH_DESKTOP_DOWNLOAD_HOST", "github").lower()


@dataclass(frozen=True)
class AppProfile:
    label: str
    persistence: str
    release_notes: tuple[str, ...]
    tests: tuple[tuple[str, ...], ...] = ()
    builds: tuple[tuple[str, ...], ...] = ()
    mobile: bool = False
    desktop_dist: bool = False
    postgres: bool = False


@dataclass(frozen=True)
class RepoState:
    path: Path
    name: str
    branch: str
    head: str
    changed_files: list[str]

    @property
    def changed(self) -> bool:
        return bool(self.changed_files)


@dataclass(frozen=True)
class ReleaseCommand:
    name: str
    args: tuple[str, ...]
    cwd: Path = ROOT
    env: dict[str, str] | None = None


@dataclass(frozen=True)
class ReleaseItem:
    state: RepoState
    version: str

    @property
    def app_id(self) -> str:
        return self.state.name.removeprefix("apps/").removeprefix("plugins/plugin-")

    @property
    def tag(self) -> str:
        return f"v{self.version}"


APP_PROFILES = {
    "apps/client-api": AppProfile(
        "Client API",
        "Postgres via deployment migration job",
        (
            "Snapshots client-api Postgres schema.",
            "Runs Postgres upgrade fixtures and idempotent migration tests.",
            "Builds @openleash/client-api.",
        ),
        tests=(("npm", "run", "typecheck", "-w", "@openleash/client-api"),),
        builds=(("npm", "run", "build", "-w", "@openleash/client-api"),),
        postgres=True,
    ),
    "apps/desktop-client": AppProfile(
        "Desktop Client",
        "Backend-required desktop client; local storage is cache/setup state only",
        (
            "Runs desktop local cache upgrade fixtures.",
            "Builds desktop client.",
            "Builds the native desktop distributable locally; tagged releases build macOS and Windows on native GitHub runners.",
        ),
        tests=(("npm", "run", "typecheck", "-w", "@openleash/desktop-client"),),
        builds=(("npm", "run", "build", "-w", "@openleash/desktop-client"),),
        desktop_dist=True,
    ),
    "apps/docs-web": AppProfile(
        "Docs Web",
        "No DB",
        ("Typechecks and builds docs web.",),
        tests=(("npm", "run", "typecheck", "-w", "@openleash/docs-web"),),
        builds=(("npm", "run", "build", "-w", "@openleash/docs-web"),),
    ),
    "apps/flow-viewer": AppProfile(
        "Flow Viewer",
        "No database; reads a local NDJSON development trace",
        ("Tests the standalone trace server and static viewer.",),
        tests=(("npm", "test", "--prefix", "apps/flow-viewer"),),
    ),
    "apps/local-proxy": AppProfile(
        "Local Proxy",
        "No database",
        ("Runs the Rust proxy test suite; tagged container releases are multi-architecture.",),
        tests=(("cargo", "test", "--manifest-path", "apps/local-proxy/Cargo.toml"),),
    ),
    "apps/main-web": AppProfile(
        "Main Web",
        "No DB",
        ("Typechecks and builds marketing/account web.",),
        tests=(("npm", "run", "typecheck", "-w", "@openleash/main-web"),),
        builds=(("npm", "run", "build", "-w", "@openleash/main-web"),),
    ),
    "apps/mobile-client": AppProfile(
        "Mobile Client",
        "No durable local DB schema yet; uses secure storage/cache and client-api",
        (
            "Runs Flutter analyze/test.",
            "Builds production Android App Bundle with the Leash Cloud API.",
            "Builds production iOS IPA when signing/export setup is available.",
        ),
        mobile=True,
    ),
    "packages/shared": AppProfile(
        "Shared Contracts",
        "No database",
        ("Typechecks and builds the stable Feature and API contracts.",),
        tests=(("npm", "run", "typecheck", "-w", "@openleash/shared"),),
        builds=(("npm", "run", "build", "-w", "@openleash/shared"),),
    ),
}


def main() -> int:
    arguments = sys.argv[1:]
    if "--production" in arguments or "--resume" in arguments or not arguments:
        from scripts.release_pipeline import main as production_release_main

        return production_release_main([argument for argument in arguments if argument != "--production"])
    if "--legacy" in arguments:
        sys.argv = [sys.argv[0], *[argument for argument in arguments if argument != "--legacy"]]
    parser = argparse.ArgumentParser(description="Interactive/app-aware Leash release conductor.")
    parser.add_argument("--version", help="Use this version for every selected app.")
    parser.add_argument("--app", action="append", default=[], help="Select app and optional version, e.g. desktop-client=0.36.0. Repeatable.")
    parser.add_argument("--all-changed", action="store_true", help="Release all changed app repos without prompting.")
    parser.add_argument("--yes", action="store_true", help="Accept suggested app selection and versions without prompting.")
    parser.add_argument("--ship", action="store_true", help="Commit, tag, and push selected app repos after gates pass.")
    parser.add_argument("--commit", action="store_true", help="Commit and tag selected app repos without pushing.")
    parser.add_argument("--push", action="store_true", help="Push commits and tags after committing.")
    parser.add_argument("--skip-snapshots", action="store_true", help="Skip schema snapshots.")
    parser.add_argument("--allow-snapshot-failures", action="store_true", help="Continue even if a selected snapshot target fails.")
    parser.add_argument("--skip-tests", action="store_true", help="Skip upgrade tests.")
    parser.add_argument("--skip-build", action="store_true", help="Skip build gate.")
    parser.add_argument("--skip-mobile-android", action="store_true", help="Do not build Android App Bundle for mobile releases.")
    parser.add_argument("--skip-mobile-ios", action="store_true", help="Do not build iOS IPA for mobile releases.")
    parser.add_argument("--skip-desktop-dist", action="store_true", help="Do not build desktop distributable artifacts.")
    parser.add_argument("--desktop-download-host", choices=("github", "gcs"), default=DEFAULT_DESKTOP_DOWNLOAD_HOST, help="Public desktop artifact host used when updating main-web download links.")
    parser.add_argument("--mobile-api-url", default=PRODUCTION_MOBILE_API_URL, help="Production API URL baked into release mobile builds.")
    parser.add_argument("--full-build", action="store_true", help="Also run full build.py after app-specific builds.")
    parser.add_argument("--skip-migration-sync", action="store_true", help="Do not auto-create a schema-sync Postgres migration.")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without changing files, committing, tagging, or pushing.")
    args = parser.parse_args()

    do_commit = args.commit or args.ship or args.push
    do_push = args.push or args.ship
    repos = discover_repos()
    states = [repo_state(repo) for repo in repos]
    changed = [state for state in states if state.changed]

    print_changed_repos(changed)
    warn_if_root_is_not_git()

    items = build_release_plan(args, states)
    items = align_release_plan_with_product(args, items, states)
    if not items:
        print("[release] no apps selected for release")
        return 0

    if should_prompt(args) and not (args.commit or args.ship or args.push):
        if confirm("After tests/builds pass, commit, tag, and push selected app repos?", default=True):
            do_commit = True
            do_push = True

    print_release_plan(items, do_commit=do_commit, do_push=do_push, dry_run=args.dry_run, desktop_download_host=args.desktop_download_host)
    if should_prompt(args) and not confirm("Run this release plan?", default=True):
        print("[release] cancelled")
        return 1

    run_product_contract_gate(args)

    if not args.skip_migration_sync and any(item.state.name in POSTGRES_APPS for item in items):
        ensure_postgres_schema_sync_migration(items, dry_run=args.dry_run)

    run_snapshot_gate(args, items)
    run_product_preparers(args, items)
    bump_versions(items, dry_run=args.dry_run)
    notes_path = write_release_notes(items, states, dry_run=args.dry_run)
    manifest_path = write_rollback_manifest(items, states, dry_run=args.dry_run)

    run_release_gates(args, items)

    if do_commit:
        if should_prompt(args) and not confirm("All gates passed. Ship commits/tags now?", default=True):
            print("[release] ship step skipped after successful gates")
            return 0
        final_states = {repo_state(item.state.path).name: repo_state(item.state.path) for item in items}
        commit_tag_push(items, final_states, push=do_push, dry_run=args.dry_run)

    print("\nRelease automation complete.")
    print(f"Release notes: {notes_path.relative_to(ROOT)}")
    print(f"Rollback manifest: {manifest_path.relative_to(ROOT)}")
    if args.dry_run and do_push:
        print("Dry run only. Would commit/tag/push selected app repos.")
    elif args.dry_run and do_commit:
        print("Dry run only. Would commit/tag selected app repos.")
    elif do_push:
        print("Pushed selected app repos.")
    elif do_commit:
        print("Committed/tagged selected app repos. Push later from each repo with: git push origin HEAD --tags")
    else:
        print("No git ship requested. Add --ship when you want commit/tag/push.")
    print("Production Leash service DB deploy command: npm run db:migrate:backup")
    print("Release is not complete yet: finish every applicable row in release.md -> Mandatory Release Definition Of Done.")
    return 0


def discover_repos() -> list[Path]:
    candidates = [*APP_REPOS, *PLUGIN_REPOS]
    if (ROOT / ".git").exists():
        candidates.insert(0, ROOT)
    return [path for path in candidates if (path / ".git").exists()]


def repo_state(repo: Path) -> RepoState:
    branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).strip()
    head = git(repo, ["rev-parse", "HEAD"]).strip()
    status = git(repo, ["status", "--porcelain"]).splitlines()
    files = [line[3:].strip() for line in status if line.strip()]
    return RepoState(repo, repo.relative_to(ROOT).as_posix() if repo != ROOT else ".", branch, head, files)


def build_release_plan(args: argparse.Namespace, states: list[RepoState]) -> list[ReleaseItem]:
    state_by_app = {state.name.removeprefix("apps/"): state for state in states}
    state_by_name = {state.name: state for state in states}
    explicit = parse_app_args(args.app)

    if explicit:
        items: list[ReleaseItem] = []
        for app, requested_version in explicit.items():
            state = state_by_app.get(app) or state_by_name.get(app)
            if not state:
                raise SystemExit(f"Unknown app repo: {app}")
            version = requested_version or suggested_next_version(state)
            validate_version(version)
            items.append(ReleaseItem(state, version))
        return items

    changed = [state for state in states if state.changed]
    if args.version:
        validate_version(args.version)
        return [ReleaseItem(state, args.version) for state in changed]

    if args.yes or args.all_changed or not sys.stdin.isatty():
        return [ReleaseItem(state, suggested_next_version(state)) for state in changed]

    items = []
    print("\nInteractive release selection")
    for state in changed:
        if not confirm(f"Release {state.name}?", default=True):
            continue
        default_version = suggested_next_version(state)
        version = prompt_version(f"Version for {state.name}", default_version)
        validate_version(version)
        items.append(ReleaseItem(state, version))
    return items


def align_release_plan_with_product(args: argparse.Namespace, items: list[ReleaseItem], states: list[RepoState]) -> list[ReleaseItem]:
    if not any(item.state.name == "apps/desktop-client" for item in items):
        return items
    if any(item.state.name == "apps/main-web" for item in items):
        return items

    main_web = next((state for state in states if state.name == "apps/main-web"), None)
    if not main_web:
        print("[release:product] warning: desktop release selected, but apps/main-web repo was not found.")
        return items

    version = args.version or suggested_next_version(main_web)
    validate_version(version)
    print("[release:product] adding apps/main-web because desktop releases must update public download links.")
    return [*items, ReleaseItem(main_web, version)]


def parse_app_args(values: list[str]) -> dict[str, str | None]:
    parsed: dict[str, str | None] = {}
    for value in values:
        if "=" in value:
            app, version = value.split("=", 1)
            parsed[normalize_app_name(app)] = version.strip()
        else:
            parsed[normalize_app_name(value)] = None
    return parsed


def normalize_app_name(value: str) -> str:
    value = value.strip().strip("/")
    if value in {"shared", "packages/shared"}:
        return "packages/shared"
    return value.removeprefix("apps/")


def suggested_next_version(state: RepoState) -> str:
    pubspec = state.path / "pubspec.yaml"
    package_json = state.path / "package.json"
    cargo_toml = state.path / "Cargo.toml"
    if pubspec.exists():
        return next_patch_version(read_pubspec_version(pubspec))
    if package_json.exists():
        return next_patch_version(read_package_version(package_json))
    if cargo_toml.exists():
        return next_patch_version(read_cargo_version(cargo_toml))
    return next_patch_version(read_package_version(ROOT / "package.json"))


def print_changed_repos(states: list[RepoState]) -> None:
    if not states:
        print("[release] no changed app repos detected")
        return
    print("[release] changed app repos:")
    for state in states:
        print(f"  - {state.name} ({len(state.changed_files)} files)")


def print_release_plan(items: list[ReleaseItem], do_commit: bool, do_push: bool, dry_run: bool, desktop_download_host: str) -> None:
    print("\nRelease plan:")
    for item in items:
        profile = profile_for(item)
        print(f"  - {item.state.name}: {current_version_label(item.state)} -> {item.version} ({item.tag})")
        print(f"    DB: {profile.persistence}")
        if item.state.name == "apps/desktop-client":
            print(f"    Desktop downloads: {desktop_download_host}")
        for note in profile.release_notes:
            print(f"    - {note}")
    print(f"  - git: {'commit/tag/push' if do_push else 'commit/tag' if do_commit else 'no commit'}")
    print(f"  - mode: {'dry run' if dry_run else 'real run'}")


def current_version_label(state: RepoState) -> str:
    pubspec = state.path / "pubspec.yaml"
    package_json = state.path / "package.json"
    cargo_toml = state.path / "Cargo.toml"
    if pubspec.exists():
        return read_pubspec_version(pubspec)
    if package_json.exists():
        return read_package_version(package_json)
    if cargo_toml.exists():
        return read_cargo_version(cargo_toml)
    return "unknown"


def warn_if_root_is_not_git() -> None:
    if not (ROOT / ".git").exists():
        print("[release] note: repo root has no .git; top-level release files cannot be auto-committed from this checkout.")


def run_release_gates(args: argparse.Namespace, items: list[ReleaseItem]) -> None:
    steps: list[ReleaseCommand] = []
    if not args.skip_tests:
        steps.extend(test_commands_for(items, args))
    if not args.skip_build:
        steps.extend(build_commands_for(items, args))
    if args.full_build and not args.skip_build:
        steps.append(ReleaseCommand("full-build-gate", ("python3", "build.py", "--full")))

    for step in dedupe_commands(steps):
        run_release_command(step, dry_run=args.dry_run)


def run_product_contract_gate(args: argparse.Namespace) -> None:
    if args.skip_tests:
        return
    run_release_command(ReleaseCommand("product-flow-contracts", ("npm", "run", "test:flows")), dry_run=args.dry_run)


def run_snapshot_gate(args: argparse.Namespace, items: list[ReleaseItem]) -> None:
    snapshot_clients = selected_snapshot_clients(items)
    if not snapshot_clients or args.skip_snapshots:
        return
    started_postgres = ensure_snapshot_dependencies(snapshot_clients, dry_run=args.dry_run)
    snapshot_args = ("python3", "snaptshot.py", *snapshot_clients)
    if args.allow_snapshot_failures:
        snapshot_args = (*snapshot_args, "--continue-on-error")
    try:
        run_release_command(ReleaseCommand("schema-snapshots", snapshot_args), dry_run=args.dry_run)
    finally:
        if started_postgres:
            # The reference Compose file uses a stable container name. Remove the
            # snapshot service before upgrade fixtures create their isolated
            # Compose project, while deliberately retaining the Postgres volume.
            run_release_command(
                ReleaseCommand("stop-snapshot-postgres", ("docker", "compose", "rm", "-s", "-f", "postgres")),
                dry_run=args.dry_run,
            )


def ensure_snapshot_dependencies(snapshot_clients: list[str], dry_run: bool) -> bool:
    postgres_clients = [client for client in snapshot_clients if CLIENTS.get(client) and CLIENTS[client].engine == "postgres"]
    if not postgres_clients or env_tool("PG_DUMP") or shutil.which("pg_dump"):
        return False

    targets = [client_target(CLIENTS[client]) or "" for client in postgres_clients]
    if not all(is_local_postgres_target(target) for target in targets):
        print("[release:schema-snapshots] pg_dump is missing; non-local Postgres targets still need PostgreSQL client tools or PG_DUMP.")
        return False

    if not shutil.which("docker"):
        print("[release:schema-snapshots] pg_dump is missing and Docker is unavailable; snapshots will fail unless PG_DUMP is set.")
        return False

    if not dry_run:
        run_release_command(ReleaseCommand("postgres-for-snapshots", ("docker", "compose", "up", "-d", "--wait", "postgres")), dry_run=False)
    else:
        run_release_command(ReleaseCommand("postgres-for-snapshots", ("docker", "compose", "up", "-d", "--wait", "postgres")), dry_run=True)
    return True


def env_tool(name: str) -> str | None:
    return env_value(name)


def is_local_postgres_target(target: str) -> bool:
    parsed = urlparse(target)
    return (parsed.hostname or "") in {"localhost", "127.0.0.1", "::1"}


def run_product_preparers(args: argparse.Namespace, items: list[ReleaseItem]) -> None:
    desktop = next((item for item in items if item.state.name == "apps/desktop-client"), None)
    if desktop:
        run_release_command(
            ReleaseCommand(
                "desktop-main-web-download-links",
                ("node", "scripts/prepare-desktop-release.mjs", "--version", desktop.version, "--download-host", args.desktop_download_host, "--links-only", "--include-windows"),
            ),
            dry_run=args.dry_run,
        )


def test_commands_for(items: list[ReleaseItem], args: argparse.Namespace) -> list[ReleaseCommand]:
    commands: list[ReleaseCommand] = []
    if any(profile_for(item).postgres for item in items):
        commands.append(ReleaseCommand("postgres-upgrade-fixtures", ("node", "scripts/test-postgres-upgrades.mjs")))
    if any(item.state.name == "apps/desktop-client" for item in items):
        commands.append(ReleaseCommand(
            "desktop-release-dependencies",
            ("npm", "run", "verify:release-dependencies", "-w", "@openleash/desktop-client"),
        ))
        commands.append(ReleaseCommand("native-rebuild-for-node", ("npm", "rebuild", "better-sqlite3")))
        commands.append(ReleaseCommand("desktop-local-cache-upgrade-fixtures", ("npx", "tsx", "scripts/test-desktop-upgrades.mjs")))
    for item in items:
        profile = profile_for(item)
        for index, command in enumerate(profile.tests, start=1):
            commands.append(ReleaseCommand(f"{item.app_id}-test-{index}", command))
        if profile.mobile:
            commands.extend(mobile_test_commands(args))
    return commands


def build_commands_for(items: list[ReleaseItem], args: argparse.Namespace) -> list[ReleaseCommand]:
    commands: list[ReleaseCommand] = []
    for item in items:
        profile = profile_for(item)
        for index, command in enumerate(profile.builds, start=1):
            commands.append(ReleaseCommand(f"{item.app_id}-build-{index}", command))
        if profile.desktop_dist and not args.skip_desktop_dist:
            if sys.platform == "darwin":
                commands.append(ReleaseCommand("desktop-macos-distributable", ("npm", "run", "dist:personal")))
                commands.append(ReleaseCommand("desktop-packaged-native-abi", ("node", "scripts/verify-packaged-desktop.mjs")))
                commands.append(ReleaseCommand("desktop-macos-installer-smoke", ("bash", "scripts/smoke-macos-installer.sh")))
            elif sys.platform.startswith("win"):
                commands.append(ReleaseCommand("desktop-windows-distributable", ("npm", "run", "dist:windows")))
            commands.append(ReleaseCommand("native-rebuild-after-desktop-dist", ("npm", "rebuild", "better-sqlite3")))
        if profile.mobile:
            commands.extend(mobile_build_commands(args))
    return commands


def mobile_test_commands(args: argparse.Namespace) -> list[ReleaseCommand]:
    if not args.dry_run:
        require_tool_for_plan("flutter", "Flutter is required to release mobile-client.")
    mobile_dir = ROOT / "apps" / "mobile-client"
    return [
        ReleaseCommand("mobile-flutter-analyze", ("flutter", "analyze"), cwd=mobile_dir),
        ReleaseCommand("mobile-flutter-test", ("flutter", "test"), cwd=mobile_dir),
    ]


def mobile_build_commands(args: argparse.Namespace) -> list[ReleaseCommand]:
    if not args.dry_run:
        require_tool_for_plan("flutter", "Flutter is required to build mobile releases.")
    mobile_dir = ROOT / "apps" / "mobile-client"
    dart_define = f"--dart-define=OPENLEASH_CLOUD_API_URL={args.mobile_api_url}"
    commands: list[ReleaseCommand] = []
    if not args.skip_mobile_android:
        commands.append(ReleaseCommand(
            "mobile-android-appbundle",
            ("flutter", "build", "appbundle", "--release", dart_define),
            cwd=mobile_dir,
        ))
    if not args.skip_mobile_ios:
        commands.append(ReleaseCommand(
            "mobile-ios-ipa",
            ("flutter", "build", "ipa", "--release", "--export-method", "app-store", dart_define),
            cwd=mobile_dir,
        ))
    return commands


def run_release_command(step: ReleaseCommand, dry_run: bool) -> None:
    print(f"\n[release:{step.name}] ({step.cwd.relative_to(ROOT) if step.cwd != ROOT else '.'}) {' '.join(step.args)}")
    if dry_run:
        return
    env = os.environ.copy()
    if step.env:
        env.update(step.env)
    subprocess.run(list(step.args), cwd=step.cwd, env=env, check=True)


def dedupe_commands(commands: list[ReleaseCommand]) -> list[ReleaseCommand]:
    seen: set[tuple[Path, tuple[str, ...]]] = set()
    deduped: list[ReleaseCommand] = []
    for command in commands:
        key = (command.cwd, command.args)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(command)
    return deduped


def require_tool_for_plan(tool: str, message: str) -> None:
    if shutil.which(tool):
        return
    raise SystemExit(message)


def selected_snapshot_clients(items: list[ReleaseItem]) -> list[str]:
    clients: list[str] = []
    for item in items:
        for client in APP_TO_SNAPSHOT.get(item.state.name, []):
            if client not in clients:
                clients.append(client)
    return clients


def profile_for(item: ReleaseItem) -> AppProfile:
    return APP_PROFILES.get(item.state.name, AppProfile(
        item.app_id,
        "Unknown persistence; release script will only version/commit this app",
        ("No app-specific release gates configured.",),
    ))


def ensure_postgres_schema_sync_migration(items: list[ReleaseItem], dry_run: bool) -> Path | None:
    if not POSTGRES_SCHEMA.exists():
        return None
    POSTGRES_MIGRATIONS.mkdir(parents=True, exist_ok=True)
    CLIENT_API_POSTGRES_MIGRATIONS.mkdir(parents=True, exist_ok=True)
    schema_text = POSTGRES_SCHEMA.read_text(encoding="utf-8")
    schema_hash = hashlib.sha256(schema_text.encode("utf-8")).hexdigest()
    sync_client_api_schema_mirror(schema_text, dry_run)

    for migration in sorted(POSTGRES_MIGRATIONS.glob("*.sql")):
        text = migration.read_text(encoding="utf-8")
        if f"canonical_schema_sha256: {schema_hash}" in text:
            print(f"[release:migration] canonical schema already represented by {migration.relative_to(ROOT)}")
            return None
        if hashlib.sha256(text.encode("utf-8")).hexdigest() == schema_hash:
            print(f"[release:migration] canonical schema matches {migration.relative_to(ROOT)}")
            sync_client_api_migration_mirror(migration, dry_run)
            return None

    version_label = "_".join(f"{item.app_id}_{item.version.replace('.', '_')}" for item in items if item.state.name in POSTGRES_APPS)
    target = POSTGRES_MIGRATIONS / f"{next_migration_number():04d}_{slugify(version_label or 'schema_sync')}.sql"
    header = "\n".join([
        "-- Leash schema sync migration",
        f"-- canonical_schema_sha256: {schema_hash}",
        "-- Generated by release.py from infra/postgres/schema.sql.",
        "-- Review if this includes destructive statements or data backfills.",
        "",
    ])
    if dry_run:
        print(f"[release:migration] would create {target.relative_to(ROOT)}")
        print(f"[release:migration] would mirror to {CLIENT_API_POSTGRES_MIGRATIONS.relative_to(ROOT)}")
        return target
    migration_text = header + schema_text.rstrip() + "\n"
    target.write_text(migration_text, encoding="utf-8")
    (CLIENT_API_POSTGRES_MIGRATIONS / target.name).write_text(migration_text, encoding="utf-8")
    print(f"[release:migration] created {target.relative_to(ROOT)}")
    print(f"[release:migration] mirrored {CLIENT_API_POSTGRES_MIGRATIONS.relative_to(ROOT) / target.name}")
    return target


def sync_client_api_schema_mirror(schema_text: str, dry_run: bool) -> None:
    if CLIENT_API_POSTGRES_SCHEMA.exists() and CLIENT_API_POSTGRES_SCHEMA.read_text(encoding="utf-8") == schema_text:
        return
    if dry_run:
        print(f"[release:migration] would sync {CLIENT_API_POSTGRES_SCHEMA.relative_to(ROOT)}")
        return
    CLIENT_API_POSTGRES_SCHEMA.parent.mkdir(parents=True, exist_ok=True)
    CLIENT_API_POSTGRES_SCHEMA.write_text(schema_text, encoding="utf-8")
    print(f"[release:migration] synced {CLIENT_API_POSTGRES_SCHEMA.relative_to(ROOT)}")


def sync_client_api_migration_mirror(migration: Path, dry_run: bool) -> None:
    target = CLIENT_API_POSTGRES_MIGRATIONS / migration.name
    text = migration.read_text(encoding="utf-8")
    if target.exists() and target.read_text(encoding="utf-8") == text:
        return
    if dry_run:
        print(f"[release:migration] would mirror {migration.relative_to(ROOT)} to {target.relative_to(ROOT)}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    print(f"[release:migration] mirrored {target.relative_to(ROOT)}")


def next_migration_number() -> int:
    numbers = []
    for file in POSTGRES_MIGRATIONS.glob("*.sql"):
        match = re.match(r"^(\d+)_", file.name)
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def bump_versions(items: list[ReleaseItem], dry_run: bool) -> None:
    for item in items:
        package_json = item.state.path / "package.json"
        pubspec = item.state.path / "pubspec.yaml"
        cargo_toml = item.state.path / "Cargo.toml"
        if package_json.exists():
            bump_package_json(package_json, item.version, dry_run)
        if pubspec.exists():
            bump_pubspec(pubspec, item.version, dry_run)
        if cargo_toml.exists():
            bump_cargo_toml(cargo_toml, item.version, dry_run)
        if item.state.name == "apps/desktop-client":
            bump_package_json(ROOT / "package.json", item.version, dry_run)
        bump_package_lock(item, dry_run)


def bump_package_json(file: Path, version: str, dry_run: bool) -> None:
    if dry_run:
        print(f"[release:version] would set {file.relative_to(ROOT)} to {version}")
        return
    data = json.loads(file.read_text(encoding="utf-8"))
    if "version" not in data:
        return
    data["version"] = version
    file.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"[release:version] set {file.relative_to(ROOT)} to {version}")


def bump_cargo_toml(file: Path, version: str, dry_run: bool) -> None:
    text = file.read_text(encoding="utf-8")
    replacement = f'version = "{version}"'
    if dry_run:
        print(f"[release:version] would set {file.relative_to(ROOT)} to {version}")
        return
    updated, count = re.subn(r'^version\s*=\s*"[^"]+"\s*$', replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f"Could not update Cargo version in {file}")
    file.write_text(updated, encoding="utf-8")
    print(f"[release:version] set {file.relative_to(ROOT)} to {version}")


def bump_package_lock(item: ReleaseItem, dry_run: bool) -> None:
    file = ROOT / "package-lock.json"
    if not file.exists():
        return
    data = json.loads(file.read_text(encoding="utf-8"))
    key = item.state.name
    if item.state.name != "apps/desktop-client" and data.get("packages", {}).get(key) is None:
        return
    if dry_run:
        print(f"[release:version] would update package-lock for {item.state.name} to {item.version}")
        return
    if data.get("packages", {}).get(key) is not None:
        data["packages"][key]["version"] = item.version
    if item.state.name == "apps/desktop-client":
        data["version"] = item.version
        if data.get("packages", {}).get("") is not None:
            data["packages"][""]["version"] = item.version
    file.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"[release:version] updated package-lock for {item.state.name}")


def bump_pubspec(file: Path, version: str, dry_run: bool) -> None:
    text = file.read_text(encoding="utf-8")
    match = re.search(r"^version:\s*([0-9]+)\.([0-9]+)\.([0-9]+)\+([0-9]+)\s*$", text, flags=re.MULTILINE)
    build = int(match.group(4)) + 1 if match else 1
    replacement = f"version: {version}+{build}"
    if dry_run:
        print(f"[release:version] would set {file.relative_to(ROOT)} to {version}+{build}")
        return
    if match:
        text = re.sub(r"^version:\s*.+$", replacement, text, count=1, flags=re.MULTILINE)
    else:
        text = text.rstrip() + "\n" + replacement + "\n"
    file.write_text(text, encoding="utf-8")
    print(f"[release:version] set {file.relative_to(ROOT)} to {version}+{build}")


def write_release_notes(items: list[ReleaseItem], states: list[RepoState], dry_run: bool) -> Path:
    label = release_label(items)
    path = RELEASE_NOTES / f"{label}.md"
    lines = [
        f"# Leash {label}",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "## Released Apps",
        "",
    ]
    for item in items:
        lines.append(f"- `{item.state.name}`: `{current_version_label(item.state)}` -> `{item.version}` (`{item.tag}`)")
    lines.extend(["", "## Changed Files", ""])
    for state in states:
        if not state.changed:
            continue
        lines.append(f"### `{state.name}`")
        for file in state.changed_files[:20]:
            lines.append(f"- `{file}`")
        if len(state.changed_files) > 20:
            lines.append(f"- ...and {len(state.changed_files) - 20} more")
        lines.append("")
    lines.extend([
        "## Migration Safety",
        "",
        "- Postgres migrations ship from `infra/postgres/migrations/` and are applied through `schema_migrations`.",
        "- Desktop local cache/setup storage migrates on app startup; product authority stays in the backend.",
        "- Mobile has no durable local SQLite migration runner until a committed local schema exists.",
        "- Production Leash service deploys should run `npm run db:migrate:backup` before starting the API.",
        "",
        "## Rollback",
        "",
        "- App rollback: deploy the previous artifact or app repo tag from the rollback manifest.",
        "- Postgres rollback: restore the pre-migration backup created by `npm run db:migrate:backup`.",
        "- Desktop/mobile local cache rollback: ship a forward fix; do not downgrade user-local cache storage automatically.",
        "",
    ])
    if dry_run:
        print(f"[release:notes] would write {path.relative_to(ROOT)}")
        return path
    RELEASE_NOTES.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[release:notes] wrote {path.relative_to(ROOT)}")
    return path


def write_rollback_manifest(items: list[ReleaseItem], states: list[RepoState], dry_run: bool) -> Path:
    label = release_label(items)
    path = RELEASE_NOTES / f"{label}.rollback.json"
    manifest = {
        "release": label,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "apps": [
            {
                "name": item.state.name,
                "version": item.version,
                "tag": item.tag,
                "head_before_release": item.state.head,
            }
            for item in items
        ],
        "repos": [
            {
                "name": state.name,
                "path": str(state.path.relative_to(ROOT)),
                "branch": state.branch,
                "head_before_release": state.head,
                "changed_files_before_release": state.changed_files,
            }
            for state in states
        ],
        "database": {
            "postgres_apply_command": "npm run db:migrate:backup",
            "rollback": "restore the backup emitted by db:migrate:backup, then redeploy previous app tags",
        },
    }
    if dry_run:
        print(f"[release:rollback] would write {path.relative_to(ROOT)}")
        return path
    RELEASE_NOTES.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"[release:rollback] wrote {path.relative_to(ROOT)}")
    return path


def release_label(items: list[ReleaseItem]) -> str:
    if len(items) == 1:
        return f"{items[0].app_id}-v{items[0].version}"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    return f"multi-app-{stamp}"


def commit_tag_push(items: list[ReleaseItem], final_states: dict[str, RepoState], push: bool, dry_run: bool) -> None:
    for item in items:
        state = final_states[item.state.name]
        message = f"Release {item.app_id} {item.version}"
        print(f"[release:git] {state.name}: {message}" + (" and push" if push else ""))
        if dry_run:
            continue
        git(state.path, ["add", "-A"])
        if not has_staged_changes(state.path):
            print(f"[release:git] {state.name}: no staged changes after version/gate updates")
            continue
        git(state.path, ["commit", "-m", message])
        git(state.path, ["tag", "-a", item.tag, "-m", message])
        if push:
            git(state.path, ["push", "origin", "HEAD"])
            git(state.path, ["push", "origin", item.tag])


def should_prompt(args: argparse.Namespace) -> bool:
    return sys.stdin.isatty() and not args.yes and not args.dry_run


def confirm(question: str, default: bool) -> bool:
    suffix = "Y/n" if default else "y/N"
    answer = input(f"{question} [{suffix}] ").strip().lower()
    if not answer:
        return default
    return answer in {"y", "yes"}


def prompt(question: str, default: str) -> str:
    answer = input(f"{question} [{default}] ").strip()
    return answer or default


def prompt_version(question: str, default: str) -> str:
    answer = input(f"{question} [{default}] ").strip()
    if not answer or answer.lower() in {"y", "yes"}:
        return default
    return answer


def read_package_version(file: Path) -> str:
    return json.loads(file.read_text(encoding="utf-8"))["version"]


def read_cargo_version(file: Path) -> str:
    text = file.read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"\s*$', text, flags=re.MULTILINE)
    if not match:
        raise SystemExit(f"Could not read Cargo version from {file}")
    return match.group(1)


def read_pubspec_version(file: Path) -> str:
    text = file.read_text(encoding="utf-8")
    match = re.search(r"^version:\s*([0-9]+\.[0-9]+\.[0-9]+)(?:\+\d+)?\s*$", text, flags=re.MULTILINE)
    if not match:
        raise SystemExit(f"Could not read pubspec version from {file}")
    return match.group(1)


def next_patch_version(version: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", version)
    if not match:
        raise SystemExit(f"Cannot auto-bump non-standard version: {version}")
    major, minor, patch = map(int, match.groups())
    return f"{major}.{minor}.{patch + 1}"


def validate_version(version: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", version):
        raise SystemExit(f"Invalid semver version: {version}")


def slugify(value: str) -> str:
    return re.sub(r"(^_+|_+$)", "", re.sub(r"[^a-z0-9]+", "_", value.lower())) or "schema_sync"


def git(repo: Path, args: list[str], check: bool = True) -> str:
    completed = subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True)
    if check and completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, ["git", *args], completed.stdout, completed.stderr)
    return completed.stdout


def has_staged_changes(repo: Path) -> bool:
    completed = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo)
    return completed.returncode == 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        cmd = " ".join(error.cmd) if isinstance(error.cmd, list) else str(error.cmd)
        stderr = getattr(error, "stderr", "") or ""
        print(f"\n[release] failed: {cmd} exited {error.returncode}", file=sys.stderr)
        if stderr.strip():
            print(stderr.strip(), file=sys.stderr)
        raise SystemExit(error.returncode)
