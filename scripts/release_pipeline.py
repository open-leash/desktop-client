#!/usr/bin/env python3
"""Deterministic, resumable Leash production release pipeline.

This module is invoked through ``python3 release.py --production``. Public
runtime components share the Leash monorepo; private cloud and website
components remain independent repositories. It does not use an LLM and it does
not infer release scope from prose or git history.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = Path.home() / ".openleash-release"
DEFAULT_CLOUD_API = "https://api.openleash.com"
DEFAULT_DASHBOARD_API = "https://cloud-dashboard-api-689989240806.us-central1.run.app"
DEFAULT_DASHBOARD_WEB = "https://dashboard.openleash.com"
DEFAULT_MAIN_WEB = "https://openleash.com"
DEFAULT_GCP_PROJECT = "cloud-497307"
DEFAULT_GCP_REGION = "us-central1"
DEFAULT_MAIN_WEB_SERVICE = "main-web"
ACTIVE_STATE_PATH: Path | None = None
TRANSIENT_GIT_ERROR_PATTERN = re.compile(
    r"(?:HTTP\s+(?:429|500|502|503|504)|RPC failed|expected flush after ref listing|"
    r"early EOF|connection (?:reset|timed out)|could not resolve host|"
    r"TLS connection|remote end hung up)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Component:
    key: str
    path: Path
    github: str
    kind: str
    test_commands: tuple[tuple[str, ...], ...]
    build_commands: tuple[tuple[str, ...], ...]


COMPONENTS: dict[str, Component] = {
    "shared": Component(
        "shared", ROOT / "packages/shared", "open-leash/leash", "tag",
        (("npm", "run", "typecheck", "-w", "@openleash/shared"),),
        (("npm", "run", "build", "-w", "@openleash/shared"),),
    ),
    "client-api": Component(
        "client-api", ROOT / "apps/engine", "open-leash/leash", "container",
        (
            ("node", "scripts/test-postgres-upgrades.mjs"),
            ("npm", "run", "test", "-w", "@openleash/client-api"),
            ("npm", "run", "typecheck", "-w", "@openleash/client-api"),
        ),
        (("npm", "run", "build", "-w", "@openleash/client-api"),),
    ),
    "local-proxy": Component(
        "local-proxy", ROOT / "apps/local-proxy", "open-leash/leash", "container",
        (("cargo", "test", "--manifest-path", "apps/local-proxy/Cargo.toml"),),
        (),
    ),
    "cloud-client-api": Component(
        "cloud-client-api", ROOT / "apps/cloud-client-api", "open-leash/cloud-client-api", "cloud",
        (
            ("npm", "test"),
            ("npm", "run", "typecheck"),
            ("npm", "run", "billing:check"),
            ("node", "scripts/test-cloud-postgres-upgrades.mjs"),
        ),
        (("npm", "run", "build"),),
    ),
    "cloud-dashboard-api": Component(
        "cloud-dashboard-api", ROOT / "apps/cloud-dashboard-api", "open-leash/cloud-dashboard-api", "cloud",
        (
            ("npm", "test"),
            ("npm", "run", "typecheck"),
        ),
        (("npm", "run", "build"),),
    ),
    "cloud-dashboard-web": Component(
        "cloud-dashboard-web", ROOT / "apps/cloud-dashboard-web", "open-leash/cloud-dashboard-web", "web",
        (),
        (("docker", "build", "--no-cache", "-t", "openleash/cloud-dashboard-web:release-gate", "."),),
    ),
    "desktop-client": Component(
        "desktop-client", ROOT / "apps/desktop", "open-leash/leash", "desktop",
        (
            ("npm", "run", "verify:release-dependencies", "-w", "@openleash/desktop-client"),
            ("npm", "run", "test", "-w", "@openleash/desktop-client"),
            ("npm", "run", "typecheck", "-w", "@openleash/desktop-client"),
            ("npx", "tsx", "scripts/test-desktop-upgrades.mjs"),
        ),
        (
            ("npm", "run", "build", "-w", "@openleash/desktop-client"),
            ("npm", "run", "dist:personal"),
            ("node", "scripts/verify-packaged-desktop.mjs"),
            ("bash", "scripts/smoke-macos-installer.sh"),
        ),
    ),
    "main-web": Component(
        "main-web", ROOT / "apps/main-web", "open-leash/main-web", "web",
        (
            ("npm", "run", "test:installer-wrapper", "-w", "@openleash/main-web"),
            ("npm", "run", "typecheck", "-w", "@openleash/main-web"),
        ),
        (("docker", "build", "--no-cache", "-t", "openleash/main-web:release-gate", "apps/main-web"),),
    ),
}

ORDER = (
    "shared",
    "client-api",
    "local-proxy",
    "cloud-client-api",
    "cloud-dashboard-api",
    "desktop-client",
    "cloud-dashboard-web",
    "main-web",
)
MENU_COMPONENTS = (
    ("desktop-client", "Desktop app", "Build the Mac/Windows client and update the website"),
    ("client-api", "Leash Engine", "Publish the Personal Open Source Engine, desktop, and website"),
    ("local-proxy", "Local proxy", "Publish the agent proxy, desktop, and website"),
    ("cloud-client-api", "Cloud client API", "Migrate and deploy the hosted client API"),
    ("cloud-dashboard-api", "Business dashboard API", "Deploy organization signup, billing, and administration"),
    ("cloud-dashboard-web", "Business dashboard", "Deploy the hosted CISO and billing dashboard"),
    ("shared", "Shared contracts", "Publish shared contracts for explicitly selected consumers"),
    ("main-web", "Main website", "Deploy the website and verify live install.sh"),
)
ALIASES = {
    "packages/shared": "shared",
    "engine": "client-api",
    "apps/engine": "client-api",
    "apps/client-api": "client-api",
    "apps/local-proxy": "local-proxy",
    "apps/cloud-client-api": "cloud-client-api",
    "cloud-api": "cloud-client-api",
    "apps/cloud-dashboard-api": "cloud-dashboard-api",
    "dashboard-api": "cloud-dashboard-api",
    "apps/cloud-dashboard-web": "cloud-dashboard-web",
    "dashboard-web": "cloud-dashboard-web",
    "apps/desktop": "desktop-client",
    "desktop": "desktop-client",
    "apps/main-web": "main-web",
    "web": "main-web",
}

DISPLAY_NAMES = {
    "client-api": "engine",
    "desktop-client": "desktop",
}


def display_name(key: str) -> str:
    return DISPLAY_NAMES.get(key, key)


class Journal:
    def __init__(self, path: Path, document: dict[str, Any], dry_run: bool):
        self.path = path
        self.document = document
        self.dry_run = dry_run

    @property
    def completed(self) -> set[str]:
        return set(self.document.setdefault("completed", []))

    def output(self, step: str) -> Any:
        return self.document.setdefault("outputs", {}).get(step)

    def run(self, step: str, action: Callable[[], Any]) -> Any:
        if step in self.completed:
            print(f"[release:resume] {step}")
            return self.output(step)
        print(f"\n[release:stage] {step}")
        if self.dry_run:
            return None
        value = action()
        self.document.setdefault("outputs", {})[step] = value
        self.document.setdefault("completed", []).append(step)
        self.save()
        return value

    def save(self) -> None:
        if self.dry_run:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(self.document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(self.path)


def main(argv: list[str] | None = None) -> int:
    global ACTIVE_STATE_PATH
    raw_arguments = list(sys.argv[1:] if argv is None else argv)
    if not raw_arguments or raw_arguments == ["--menu"]:
        raw_arguments = interactive_release_arguments()
    parser = argparse.ArgumentParser(
        description="Deterministic Leash production release pipeline (tests, migrations, artifacts, deploys, live verification)."
    )
    parser.add_argument("--app", "--component", action="append", dest="apps", default=[], help="Component and optional version, e.g. engine=0.37.4. Repeatable.")
    parser.add_argument("--version", help="Version for components that do not specify one explicitly.")
    parser.add_argument("--ship", action="store_true", help="Execute the complete commit, publish, deploy, and verify pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Print the complete ordered plan without changing local or remote state.")
    parser.add_argument("--yes", action="store_true", help="Required with --ship; confirms the explicit component/version plan.")
    parser.add_argument("--resume", type=Path, help="Resume an interrupted release from its state JSON.")
    parser.add_argument("--state-file", type=Path, help="Write resumable release state to this path.")
    parser.add_argument("--desktop-channel", choices=("terminal", "stable"), default="terminal", help="Terminal is locally signed and installed through install.sh; stable requires Apple signing/notarization secrets.")
    parser.add_argument("--migration-target", choices=("gcp", "custom"), default="gcp", help="Production Postgres target used before cloud-client-api deployment.")
    parser.add_argument("--database-url", help="Explicit production Postgres URL for --migration-target custom.")
    parser.add_argument("--cloud-source-only", action="store_true", help="Push cloud-client-api source but do not migrate, deploy, or verify production.")
    parser.add_argument("--cloud-api-url", default=DEFAULT_CLOUD_API)
    parser.add_argument("--dashboard-api-url", default=DEFAULT_DASHBOARD_API)
    parser.add_argument("--dashboard-web-url", default=DEFAULT_DASHBOARD_WEB)
    parser.add_argument("--main-web-url", default=DEFAULT_MAIN_WEB)
    parser.add_argument("--gcp-project", default=DEFAULT_GCP_PROJECT)
    parser.add_argument("--gcp-region", default=DEFAULT_GCP_REGION)
    parser.add_argument("--main-web-service", default=DEFAULT_MAIN_WEB_SERVICE)
    parser.add_argument("--rollout", type=int, default=100, help="Desktop stable update rollout percentage.")
    parser.add_argument("--timeout", type=int, default=1800, help="Maximum seconds for each remote workflow/deployment gate.")
    args = parser.parse_args(raw_arguments)

    if not args.dry_run and not args.ship:
        parser.error("choose --dry-run or --ship")
    if args.ship and not args.yes:
        parser.error("--ship requires --yes")
    if not 0 <= args.rollout <= 100:
        parser.error("--rollout must be between 0 and 100")
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")

    if args.resume:
        document = json.loads(args.resume.resolve().read_text(encoding="utf-8"))
        requested = {key: str(value) for key, value in document["versions"].items()}
        args.desktop_channel = str(document.get("desktop_channel", args.desktop_channel))
        # Resuming reconfirms the complete immutable plan stored in the journal,
        # including required surfaces that were originally added automatically.
        explicit_components = set(requested)
        state_path = args.resume.resolve()
    else:
        requested = parse_selection(args.apps, args.version)
        explicit_components = set(requested)
        requested = add_required_surfaces(requested)
        if not requested:
            parser.error("select at least one component with --app")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%fZ")
        state_path = (args.state_file or STATE_DIR / f"production-{stamp}.json").resolve()
        document = {
            "format": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "versions": requested,
            "explicit_components": sorted(explicit_components),
            "desktop_channel": args.desktop_channel,
            "config": {
                "cloud_source_only": args.cloud_source_only,
                "cloud_api_url": args.cloud_api_url,
                "dashboard_api_url": args.dashboard_api_url,
                "dashboard_web_url": args.dashboard_web_url,
                "main_web_url": args.main_web_url,
                "gcp_project": args.gcp_project,
                "gcp_region": args.gcp_region,
                "main_web_service": args.main_web_service,
                "migration_target": args.migration_target,
                "rollout": args.rollout,
            },
            "completed": [],
            "outputs": {},
        }

    ACTIVE_STATE_PATH = state_path
    args.release_state_path = state_path

    if args.resume:
        config = document.get("config", {})
        args.cloud_source_only = bool(config.get("cloud_source_only", args.cloud_source_only))
        args.cloud_api_url = str(config.get("cloud_api_url", args.cloud_api_url))
        args.dashboard_api_url = str(config.get("dashboard_api_url", args.dashboard_api_url))
        args.dashboard_web_url = str(config.get("dashboard_web_url", args.dashboard_web_url))
        args.main_web_url = str(config.get("main_web_url", args.main_web_url))
        args.gcp_project = str(config.get("gcp_project", args.gcp_project))
        args.gcp_region = str(config.get("gcp_region", args.gcp_region))
        args.main_web_service = str(config.get("main_web_service", args.main_web_service))
        args.migration_target = str(config.get("migration_target", args.migration_target))
        args.rollout = int(config.get("rollout", args.rollout))

    selected = [key for key in ORDER if key in requested]
    args.explicit_components = explicit_components
    print_plan(selected, requested, args, state_path)
    if args.dry_run:
        print_dry_run_stages(selected, args)
        return 0

    journal = Journal(state_path, document, dry_run=False)
    journal.save()
    journal.run("preflight", lambda: preflight(selected, requested, args))
    journal.run("product-contract", lambda: run_command(("npm", "run", "test:flows"), ROOT))
    journal.run("release-wide-tests", lambda: run_release_wide_tests(selected))

    released: dict[str, dict[str, str]] = dict(journal.document.setdefault("released", {}))
    for key in selected:
        component = COMPONENTS[key]
        version = requested[key]
        journal.run(f"{key}:prepare", lambda c=component, v=version: prepare_component(c, v, released, requested, args))
        journal.run(f"{key}:gates", lambda c=component: run_component_gates(c))
        commit = journal.run(f"{key}:commit", lambda c=component, v=version: commit_component(c, v))
        if commit is None:
            commit = git(component.path, "rev-parse", "HEAD").strip()

        if key == "cloud-client-api" and not args.cloud_source_only:
            journal.run("cloud-client-api:migrate", lambda: run_cloud_migrations(args, "backup-apply"))

        journal.run(f"{key}:push", lambda c=component, v=version: push_component(c, v, args))
        publication = journal.run(
            f"{key}:publish",
            lambda c=component, v=version, sha=commit: publish_component(c, v, sha, args),
        ) or {}
        released[key] = {"version": version, "commit": commit, **publication}
        journal.document["released"] = released
        journal.save()

        if key == "client-api":
            digest = released[key].get("digest")
            if not digest:
                raise RuntimeError("client-api publication did not return an immutable digest")
            journal.run("client-api:pin-consumers", lambda d=digest, v=version: pin_client_api_consumers(v, d))
            journal.run("public-core:commit-pins", lambda: commit_and_push_root_pins("Update Personal Open Source client API release"))
            journal.run("client-api:published-image-smoke", lambda d=digest, v=version: smoke_personal_image(v, d))
        elif key == "local-proxy":
            digest = released[key].get("digest")
            if not digest:
                raise RuntimeError("local-proxy publication did not return an immutable digest")
            journal.run("local-proxy:pin-desktop", lambda d=digest, v=version: pin_local_proxy(v, d))

    if "cloud-client-api" in selected and not args.cloud_source_only:
        journal.run("cloud-client-api:migration-status", lambda: run_cloud_migrations(args, "status"))
        cloud_version = requested["cloud-client-api"]
        journal.run(
            "cloud-client-api:live-health",
            lambda: wait_for_json_health(
                f"{args.cloud_api_url.rstrip('/')}/cloud/health",
                "openleash-cloud-client-api",
                cloud_version,
                args.timeout,
            ),
        )
    if "cloud-dashboard-api" in selected:
        dashboard_api_version = requested["cloud-dashboard-api"]
        journal.run(
            "cloud-dashboard-api:live-health",
            lambda: wait_for_json_health(
                f"{args.dashboard_api_url.rstrip('/')}/cloud/admin/health",
                "openleash-cloud-dashboard-api",
                dashboard_api_version,
                args.timeout,
            ),
        )
    if "cloud-dashboard-web" in selected:
        journal.run(
            "cloud-dashboard-web:live-health",
            lambda: wait_for_web_health(args.dashboard_web_url, args.timeout),
        )
    if "main-web" in selected:
        desktop_version = requested.get("desktop-client")
        journal.run(
            "main-web:live-installer",
            lambda: wait_for_live_installer(args.main_web_url, desktop_version, args.timeout),
        )

    journal.document["finished_at"] = datetime.now(timezone.utc).isoformat()
    journal.save()
    print(f"\n[release] production release complete. State: {journal.path}")
    return 0


def interactive_release_arguments(input_fn: Callable[[str], str] = input) -> list[str]:
    print("\nLeash production release")
    print("Select one or more components. Required desktop/website releases are added automatically.\n")
    for index, (key, label, description) in enumerate(MENU_COMPONENTS, start=1):
        print(f"  {index}. {label:<20} {description} [{display_component_version(key)}]")
    journals = recent_release_journals()
    if journals:
        print("  R. Resume a previous release")
    print("  Q. Quit")

    selection = read_menu_selection(input_fn, len(MENU_COMPONENTS), allow_resume=bool(journals))
    if selection == "resume":
        return interactive_resume_arguments(journals, input_fn)

    requested: dict[str, str] = {}
    for index in selection:
        key = MENU_COMPONENTS[index - 1][0]
        component = COMPONENTS[key]
        current = component_version(component)
        suggested = next_patch(current)
        entered = prompt(input_fn, f"{MENU_COMPONENTS[index - 1][1]} version", suggested)
        validate_version(entered)
        requested[key] = entered

    expanded = add_required_surfaces(requested)
    print("\nRelease plan:")
    for key in ORDER:
        if key not in expanded:
            continue
        suffix = "" if key in requested else " (added automatically)"
        print(f"  - {display_name(key)}: {component_version(COMPONENTS[key])} -> {expanded[key]}{suffix}")

    arguments: list[str] = []
    for key in ORDER:
        if key in expanded:
            arguments.extend(("--app", f"{key}={expanded[key]}"))

    if "desktop-client" in expanded:
        print("\nDesktop channel:")
        print("  1. Terminal installer — Mac release without Apple notarization (recommended)")
        print("  2. Stable signed — Mac + Windows; requires signing/notarization secrets")
        channel = prompt(input_fn, "Choose", "1")
        if channel not in {"1", "2"}:
            raise SystemExit("Cancelled: desktop channel must be 1 or 2.")
        arguments.extend(("--desktop-channel", "terminal" if channel == "1" else "stable"))

    if "cloud-client-api" in requested:
        print("\nCloud publication:")
        print("  1. Production — backup, migrate, deploy, and verify live (recommended)")
        print("  2. Source only — push source without a production deployment")
        cloud_mode = prompt(input_fn, "Choose", "1")
        if cloud_mode not in {"1", "2"}:
            raise SystemExit("Cancelled: cloud publication must be 1 or 2.")
        if cloud_mode == "2":
            arguments.append("--cloud-source-only")

    print("\nAction:")
    print("  1. Show plan only — no files or remote systems change (recommended first)")
    print("  2. RELEASE — run every gate, migration, build, upload, deploy, and live check")
    action = prompt(input_fn, "Choose", "1")
    if action == "1":
        arguments.extend(("--dry-run", "--yes"))
        return arguments
    if action != "2":
        raise SystemExit("Cancelled: action must be 1 or 2.")
    confirmation = prompt(input_fn, "Type RELEASE to continue", "")
    if confirmation != "RELEASE":
        raise SystemExit("Release cancelled.")
    arguments.extend(("--ship", "--yes"))
    return arguments


def read_menu_selection(input_fn: Callable[[str], str], item_count: int, allow_resume: bool) -> list[int] | str:
    raw = prompt(input_fn, "Components (comma-separated)", "").strip().lower()
    if raw in {"q", "quit"}:
        raise SystemExit("Release cancelled.")
    if raw in {"r", "resume"} and allow_resume:
        return "resume"
    try:
        selected = sorted({int(value.strip()) for value in raw.split(",") if value.strip()})
    except ValueError as error:
        raise SystemExit("Cancelled: enter component numbers separated by commas.") from error
    if not selected or any(value < 1 or value > item_count for value in selected):
        raise SystemExit(f"Cancelled: select component numbers from 1 to {item_count}.")
    return selected


def interactive_resume_arguments(journals: list[Path], input_fn: Callable[[str], str]) -> list[str]:
    print("\nInterrupted releases:")
    for index, path in enumerate(journals, start=1):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            versions = ", ".join(f"{key}={value}" for key, value in document.get("versions", {}).items())
        except (OSError, json.JSONDecodeError):
            versions = "unreadable state"
        print(f"  {index}. {path.name}  {versions}")
    choice = prompt(input_fn, "Resume which release", "1")
    try:
        selected = int(choice)
    except ValueError as error:
        raise SystemExit("Cancelled: choose a release number.") from error
    if selected < 1 or selected > len(journals):
        raise SystemExit("Cancelled: release number is out of range.")

    print("\nAction:")
    print("  1. Show the saved plan only")
    print("  2. Resume the production release")
    action = prompt(input_fn, "Choose", "1")
    arguments = ["--resume", str(journals[selected - 1])]
    if action == "1":
        return [*arguments, "--dry-run"]
    if action != "2":
        raise SystemExit("Cancelled: action must be 1 or 2.")
    confirmation = prompt(input_fn, "Type RELEASE to continue", "")
    if confirmation != "RELEASE":
        raise SystemExit("Release cancelled.")
    return [*arguments, "--ship", "--yes"]


def recent_release_journals(limit: int = 5) -> list[Path]:
    if not STATE_DIR.exists():
        return []
    candidates = [path for path in STATE_DIR.glob("production-*.json") if path.is_file()]
    return sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True)[:limit]


def display_component_version(key: str) -> str:
    try:
        return f"current {component_version(COMPONENTS[key])}"
    except (OSError, RuntimeError, KeyError, json.JSONDecodeError):
        return "checkout missing"


def prompt(input_fn: Callable[[str], str], label: str, default: str) -> str:
    suffix = f" [{default}]" if default else ""
    try:
        value = input_fn(f"{label}{suffix}: ").strip()
    except (EOFError, KeyboardInterrupt) as error:
        print()
        raise SystemExit("Release cancelled.") from error
    return value or default


def parse_selection(values: list[str], common_version: str | None) -> dict[str, str]:
    selected: dict[str, str] = {}
    for raw in values:
        name, separator, explicit = raw.partition("=")
        key = ALIASES.get(name.strip().strip("/"), name.strip().removeprefix("apps/").removeprefix("packages/"))
        if key not in COMPONENTS:
            raise SystemExit(f"Unknown release component: {name}")
        version = explicit.strip() if separator else common_version or next_patch(component_version(COMPONENTS[key]))
        validate_version(version)
        selected[key] = version
    return selected


def add_required_surfaces(selected: dict[str, str]) -> dict[str, str]:
    result = dict(selected)
    if "client-api" in result or "local-proxy" in result:
        result.setdefault("desktop-client", next_patch(component_version(COMPONENTS["desktop-client"])))
    if "desktop-client" in result:
        result.setdefault("main-web", next_patch(component_version(COMPONENTS["main-web"])))
    return result


def print_plan(selected: list[str], versions: dict[str, str], args: argparse.Namespace, state_path: Path) -> None:
    print("Leash deterministic production release")
    for key in selected:
        current = display_component_version(key).removeprefix("current ")
        print(f"  - {display_name(key)}: {current} -> {versions[key]}")
    if "desktop-client" in selected:
        print(f"  - desktop channel: {args.desktop_channel}")
    if "cloud-client-api" in selected:
        print(f"  - cloud migrations: {'source only' if args.cloud_source_only else args.migration_target + ' backup + apply + status'}")
    print(f"  - state: {state_path}")


def print_dry_run_stages(selected: list[str], args: argparse.Namespace) -> None:
    print("\nOrdered stages:")
    print("  1. preflight branches, remotes, tools, versions, and append-only migrations")
    print("  2. public product contract")
    number = 3
    for key in selected:
        print(f"  {number}. {display_name(key)}: prepare -> test/build -> commit -> push -> publish/deploy -> verify")
        number += 1
        if key == "client-api":
            print(f"  {number}. pin the published Engine digest; test the actual Personal Open Source image")
            number += 1
    if "cloud-client-api" in selected and not args.cloud_source_only:
        print(f"  {number}. production migration status and exact-version live cloud health")
        number += 1
    if "main-web" in selected:
        print(f"  {number}. direct Google Cloud main-web deploy and live install.sh download/checksum verification")
    if "desktop-client" in selected and args.desktop_channel == "terminal":
        print("  - macOS artifacts use the release-gated Terminal installer workflow")


def preflight(selected: list[str], versions: dict[str, str], args: argparse.Namespace) -> dict[str, Any]:
    required = {"git", "node", "npm", "gh", "curl"}
    if any(key in selected for key in ("client-api", "cloud-client-api", "cloud-dashboard-web", "desktop-client", "main-web")):
        required.add("docker")
    if "local-proxy" in selected:
        required.add("cargo")
    if "main-web" in selected:
        required.add("gcloud")
    missing = sorted(tool for tool in required if not shutil.which(tool))
    if missing:
        raise RuntimeError(f"Missing release tools: {', '.join(missing)}")
    if "desktop-client" in selected and platform.system() != "Darwin":
        raise RuntimeError("The local desktop release gate must run on macOS.")
    run_command(("gh", "auth", "status"), ROOT)
    if "main-web" in selected:
        active_gcp_account = capture((
            "gcloud", "auth", "list", "--filter=status:ACTIVE", "--format=value(account)",
        ), ROOT).strip()
        if not active_gcp_account:
            raise RuntimeError("main-web releases require an authenticated Google Cloud account")
        service = capture((
            "gcloud", "run", "services", "describe", args.main_web_service,
            f"--project={args.gcp_project}", f"--region={args.gcp_region}",
            "--format=value(metadata.name)",
        ), ROOT).strip()
        if service != args.main_web_service:
            raise RuntimeError(
                f"Google Cloud service {args.main_web_service!r} was not found in {args.gcp_project}/{args.gcp_region}"
            )
    checked: dict[str, str] = {}
    if "client-api" in selected:
        git(ROOT, "fetch", "origin", "main")
        root_behind = int(git(ROOT, "rev-list", "--count", "HEAD..origin/main").strip() or "0")
        if root_behind:
            raise RuntimeError(f"public core is {root_behind} commit(s) behind origin/main")
        generated_paths = ("scripts/install-openleash-personal.sh", "deploy/docker/individual-open-source.compose.yml")
        if git(ROOT, "status", "--porcelain", "--", *generated_paths).strip():
            raise RuntimeError("Personal Open Source release pin files already have local edits; commit or restore them before release.")
    for key in selected:
        component = COMPONENTS[key]
        if not git(component.path, "rev-parse", "--is-inside-work-tree", check=False).strip() == "true":
            raise RuntimeError(f"Missing repository checkout: {component.path}")
        branch = git(component.path, "branch", "--show-current").strip()
        if branch != "main":
            raise RuntimeError(f"{key} must be released from main, found {branch!r}")
        git(component.path, "fetch", "origin", "main", "--tags")
        behind = int(git(component.path, "rev-list", "--count", "HEAD..origin/main").strip() or "0")
        if behind:
            raise RuntimeError(f"{key} is {behind} commit(s) behind origin/main")
        validate_version(versions[key])
        if not args.resume and semver_core(versions[key]) <= semver_core(component_version(component)):
            raise RuntimeError(
                f"{key} release version {versions[key]} must be greater than current {component_version(component)}"
            )
        if key not in args.explicit_components and git(component.path, "status", "--porcelain").strip():
            raise RuntimeError(
                f"{key} was added automatically but already has local changes; select it explicitly to include them"
            )
        tag = component_tag(component, versions[key])
        remote_tag = git(component.path, "ls-remote", "--tags", "origin", f"refs/tags/{tag}").strip()
        if remote_tag and not args.resume:
            raise RuntimeError(f"{component.github} already has immutable tag {tag}; choose a new version or resume its state file")
        checked[key] = git(component.path, "rev-parse", "HEAD").strip()
    if "client-api" in selected:
        validate_append_only_migrations(COMPONENTS["client-api"].path, Path("infra/postgres/migrations"))
    if "cloud-client-api" in selected:
        for dependency_key in ("shared", "client-api"):
            if dependency_key in selected:
                continue
            dependency = COMPONENTS[dependency_key]
            git(dependency.path, "fetch", "origin", "main")
            head = git(dependency.path, "rev-parse", "HEAD").strip()
            remote = git(dependency.path, "rev-parse", "origin/main").strip()
            if head != remote or git(dependency.path, "status", "--porcelain").strip():
                raise RuntimeError(
                    f"cloud-client-api dependency {dependency_key} must be a clean origin/main checkout or explicitly selected"
                )
        validate_append_only_migrations(COMPONENTS["cloud-client-api"].path, Path("infra/postgres/migrations"))
        if not args.cloud_source_only:
            resolve_migration_database(args)
            run_cloud_migrations(args, "status")
    return checked


def validate_append_only_migrations(repo: Path, directory: Path) -> None:
    changes = git(repo, "diff", "--name-status", "origin/main", "--", str(directory))
    for line in changes.splitlines():
        status = line.split(maxsplit=1)[0]
        if status != "A":
            raise RuntimeError(f"Applied migration history is append-only; found {line}")


def prepare_component(component: Component, version: str, released: dict[str, dict[str, str]], requested: dict[str, str], args: argparse.Namespace) -> dict[str, Any]:
    if component.key == "client-api" and "shared" in released:
        pin_shared_dependency(component.path, released["shared"]["version"], released["shared"]["commit"])
    elif component.key == "cloud-client-api":
        shared = released.get("shared") or current_release_identity(COMPONENTS["shared"])
        client = released.get("client-api") or current_release_identity(COMPONENTS["client-api"])
        pin_cloud_dependencies(shared, client)
    elif component.key == "cloud-dashboard-web":
        run_command(("python3", "scripts/vendor-dashboard-web.py"), component.path)
    elif component.key == "desktop-client" and "shared" in released:
        pin_desktop_shared(released["shared"]["version"])
    bump_component_version(component, version)
    if component.key == "desktop-client":
        command = [
            "node", "scripts/prepare-desktop-release.mjs", "--version", version,
            "--download-host", "github", "--links-only",
        ]
        if args.desktop_channel == "terminal":
            command.append("--terminal-installer")
        else:
            command.append("--include-windows")
        run_command(tuple(command), ROOT)
    return {"version": version}


def run_component_gates(component: Component) -> None:
    if component.key in {"client-api", "desktop-client", "main-web"}:
        run_command(("npm", "run", "test:flows"), ROOT)
    for command in component.test_commands:
        run_command(command, component_command_cwd(component, command))
    for command in component.build_commands:
        run_command(command, component_command_cwd(component, command))


def run_release_wide_tests(selected: list[str]) -> dict[str, str]:
    """Run every selected test gate before the first remote mutation."""
    for key in selected:
        component = COMPONENTS[key]
        for command in component.test_commands:
            run_command(command, component_command_cwd(component, command))
    return {"status": "passed"}


def component_command_cwd(component: Component, command: tuple[str, ...]) -> Path:
    if component.key == "cloud-dashboard-web":
        return component.path
    if component.key.startswith("cloud-") and command[0] == "npm":
        return component.path
    return ROOT


def commit_component(component: Component, version: str) -> str:
    git(component.path, "add", "-A")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=component.path).returncode == 1:
        git(component.path, "commit", "-m", f"Release {component.key} {version}")
    elif component_version(component) != version:
        raise RuntimeError(f"{component.key} has no releasable changes and is not already v{version}")
    return git(component.path, "rev-parse", "HEAD").strip()


def push_component(component: Component, version: str, args: argparse.Namespace) -> dict[str, str]:
    git(component.path, "push", "origin", "HEAD:main")
    if component.kind == "desktop" and args.desktop_channel == "terminal":
        return {"commit": git(component.path, "rev-parse", "HEAD").strip()}
    ensure_tag(component, version)
    tag = component_tag(component, version)
    git(component.path, "push", "origin", tag)
    if component.kind == "desktop" and args.desktop_channel == "stable":
        ensure_github_release(component.github, version, prerelease=False)
        return {"tag": tag}


def publish_component(component: Component, version: str, commit: str, args: argparse.Namespace) -> dict[str, str]:
    if component.kind == "container":
        workflow = "publish-engine.yml" if component.key == "client-api" else "publish-local-proxy.yml"
        wait_for_workflow(component.github, workflow, commit, args.timeout)
        digest = wait_for_ghcr_digest(component.github.split("/", 1)[1], version, args.timeout)
        return {"digest": digest}
    if component.kind == "desktop":
        if args.desktop_channel == "terminal":
            output = capture((
                "gh", "workflow", "run", "release-terminal-macos.yml", "--repo", component.github,
                "-f", f"release_tag=v{version}",
            ), ROOT)
            match = re.search(r"/actions/runs/(\d+)", output)
            if not match:
                raise RuntimeError(f"Could not identify dispatched desktop workflow: {output.strip()}")
            run_command(("gh", "run", "watch", match.group(1), "--repo", component.github, "--exit-status"), ROOT)
            verify_desktop_release(component.github, version, terminal=True)
        else:
            wait_for_workflow(component.github, "release-macos.yml", commit, args.timeout)
            wait_for_workflow(component.github, "release-windows.yml", commit, args.timeout)
            verify_desktop_release(component.github, version, terminal=False)
            run_command((
                "node", "scripts/publish-desktop-update.mjs", "--version", version,
                "--rollout", str(args.rollout), "--api", args.cloud_api_url,
            ), ROOT)
        return {"release": f"https://github.com/{component.github}/releases/tag/v{version}"}
    if component.key == "main-web":
        return deploy_main_web_to_gcp(component, commit, args)
    if component.kind in {"cloud", "web"}:
        if component.key == "cloud-client-api" and args.cloud_source_only:
            return {"source_only": "true"}
        wait_for_checks(component.github, commit, args.timeout, required_app="Google Cloud Build")
        return {"deployed_commit": commit}
    return {"tag": f"v{version}"}


def deploy_main_web_to_gcp(component: Component, commit: str, args: argparse.Namespace) -> dict[str, str]:
    """Build local main-web source and deploy its immutable image directly to Google Cloud."""
    repository = (
        f"{args.gcp_region}-docker.pkg.dev/{args.gcp_project}/"
        f"cloud-run-source-deploy/{args.main_web_service}/{args.main_web_service}"
    )
    image_tag = f"{repository}:{commit}"
    run_command((
        "gcloud", "builds", "submit", ".",
        f"--project={args.gcp_project}", "--region=global",
        f"--tag={image_tag}", "--quiet",
    ), component.path)
    digest = capture((
        "gcloud", "artifacts", "docker", "images", "describe", image_tag,
        f"--project={args.gcp_project}", "--format=value(image_summary.digest)",
    ), ROOT).strip()
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise RuntimeError(f"Google Artifact Registry returned an invalid main-web digest: {digest!r}")
    image = f"{repository}@{digest}"
    run_command((
        "gcloud", "run", "services", "update", args.main_web_service,
        f"--project={args.gcp_project}", f"--region={args.gcp_region}",
        "--platform=managed", f"--image={image}",
        f"--update-labels=managed-by=leash-release,commit-sha={commit}",
        "--quiet",
    ), ROOT)
    service = json.loads(capture((
        "gcloud", "run", "services", "describe", args.main_web_service,
        f"--project={args.gcp_project}", f"--region={args.gcp_region}",
        "--format=json",
    ), ROOT))
    labels = service.get("metadata", {}).get("labels", {})
    containers = (
        service.get("spec", {})
        .get("template", {})
        .get("spec", {})
        .get("containers", [])
    )
    deployed_image = containers[0].get("image", "") if containers else ""
    traffic = service.get("status", {}).get("traffic") or []
    if labels.get("commit-sha") != commit:
        raise RuntimeError("Google Cloud Run did not report the released main-web commit label")
    if digest not in deployed_image:
        raise RuntimeError(f"Google Cloud Run did not retain the immutable main-web image: {deployed_image!r}")
    if not any(entry.get("latestRevision") and entry.get("percent") == 100 for entry in traffic):
        raise RuntimeError("Google Cloud Run main-web is not serving 100 percent from its latest revision")
    revision = str(service.get("status", {}).get("latestReadyRevisionName") or "")
    if not revision:
        raise RuntimeError("Google Cloud Run did not report a ready main-web revision")
    return {
        "deployed_commit": commit,
        "image": image,
        "image_digest": digest,
        "revision": revision,
    }


def wait_for_workflow(repo: str, workflow: str, commit: str, timeout: int) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        command = ["gh", "run", "list", "--repo", repo, "--workflow", workflow, "--limit", "10", "--json", "databaseId,headSha,status,conclusion,createdAt"]
        runs = json.loads(capture(command, ROOT))
        matching = [run for run in runs if run.get("headSha") == commit]
        if matching:
            run = matching[0]
            run_id = str(run["databaseId"])
            run_command(("gh", "run", "watch", run_id, "--repo", repo, "--exit-status"), ROOT)
            return
        time.sleep(3)
    raise RuntimeError(f"Timed out waiting for {repo} workflow {workflow} at {commit}")


def wait_for_checks(repo: str, commit: str, timeout: int, required_app: str | None = None) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        checks = load_check_runs(repo, commit)
        if required_app:
            checks = [check for check in checks if check.get("app", {}).get("name") == required_app]
        if checks and all(check.get("status") == "completed" for check in checks):
            failures = [check for check in checks if check.get("conclusion") not in {"success", "neutral", "skipped"}]
            if failures:
                raise RuntimeError(f"Deployment checks failed for {repo}: {[(check.get('name'), check.get('conclusion')) for check in failures]}")
            return
        time.sleep(5)
    raise RuntimeError(f"Timed out waiting for deployment checks on {repo}@{commit}")


def load_check_runs(repo: str, commit: str) -> list[dict[str, Any]]:
    """Read commit checks, falling back to GraphQL when GitHub's REST API is degraded."""
    try:
        payload = json.loads(capture(("gh", "api", f"repos/{repo}/commits/{commit}/check-runs"), ROOT))
        return list(payload.get("check_runs") or [])
    except subprocess.CalledProcessError as rest_error:
        owner, name = repo.split("/", 1)
        query = """
        query($owner: String!, $name: String!, $oid: GitObjectID!) {
          repository(owner: $owner, name: $name) {
            object(oid: $oid) {
              ... on Commit {
                statusCheckRollup {
                  contexts(first: 100) {
                    nodes {
                      ... on CheckRun {
                        name status conclusion
                        checkSuite { app { name } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        """
        try:
            payload = json.loads(capture((
                "gh", "api", "graphql", "-f", f"query={query}",
                "-F", f"owner={owner}", "-F", f"name={name}", "-F", f"oid={commit}",
            ), ROOT))
        except subprocess.CalledProcessError:
            raise rest_error
        repository = payload.get("data", {}).get("repository") or {}
        commit_object = repository.get("object") or {}
        rollup = commit_object.get("statusCheckRollup") or {}
        contexts = rollup.get("contexts") or {}
        nodes = contexts.get("nodes") or []
        return [
            {
                **node,
                "status": str(node.get("status", "")).lower(),
                "conclusion": str(node.get("conclusion", "")).lower(),
                "app": node.get("checkSuite", {}).get("app", {}),
            }
            for node in nodes
            if node.get("name")
        ]


def wait_for_ghcr_digest(repository: str, version: str, timeout: int) -> str:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            return resolve_ghcr_digest(repository, version)
        except (RuntimeError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(3)
    raise RuntimeError(f"Timed out waiting for GHCR {repository}:{version}: {last_error}")


def resolve_ghcr_digest(repository: str, version: str) -> str:
    scope = urllib.parse.quote(f"repository:open-leash/{repository}:pull", safe="")
    token_payload = fetch_json(f"https://ghcr.io/token?service=ghcr.io&scope={scope}")
    token = token_payload.get("token")
    if not token:
        raise RuntimeError(f"GHCR did not issue an anonymous token for {repository}:{version}")
    request = urllib.request.Request(
        f"https://ghcr.io/v2/open-leash/{repository}/manifests/{version}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        digest = response.headers.get("Docker-Content-Digest", "")
        manifest = json.load(response)
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise RuntimeError(f"GHCR returned an invalid digest for {repository}:{version}: {digest!r}")
    platforms = {
        f"{entry.get('platform', {}).get('os')}/{entry.get('platform', {}).get('architecture')}"
        for entry in manifest.get("manifests", [])
        if entry.get("platform", {}).get("architecture") != "unknown"
    }
    missing = {"linux/amd64", "linux/arm64"} - platforms
    if missing:
        raise RuntimeError(f"{repository}:{version} is missing platforms: {', '.join(sorted(missing))}")
    return digest


def pin_client_api_consumers(version: str, digest: str) -> dict[str, str]:
    value = f"{version}@{digest}"
    files = [
        ROOT / "scripts/install-openleash-personal.sh",
        ROOT / "deploy/docker/individual-open-source.compose.yml",
        ROOT / "apps/desktop/src/main.ts",
    ]
    for file in files:
        source = file.read_text(encoding="utf-8")
        updated = replace_client_api_pin_text(source, value)
        if updated == source:
            raise RuntimeError(f"Client API release pin was not found in {file.relative_to(ROOT)}")
        file.write_text(updated, encoding="utf-8")
    return {"version": version, "digest": digest}


def replace_client_api_pin_text(source: str, value: str) -> str:
    return re.sub(
        r"client-api:(\\?)\$\{OPENLEASH_VERSION:-[^}]+\}",
        lambda match: f"client-api:{match.group(1)}${{OPENLEASH_VERSION:-{value}}}",
        source,
    )


def pin_local_proxy(version: str, digest: str) -> dict[str, str]:
    version_file = ROOT / "apps/desktop/local-proxy.version"
    version_file.write_text(f"{version}\n", encoding="utf-8")
    return {"version": version, "container_digest": digest}


def pin_shared_dependency(repo: Path, version: str, commit: str) -> None:
    update_json_dependency(repo / "package.json", "@openleash/shared", version)
    dockerfile = repo / "Dockerfile"
    replace_regex(dockerfile, r"ARG OPENLEASH_SHARED_REF=[a-f0-9]{40}", f"ARG OPENLEASH_SHARED_REF={commit}")


def pin_cloud_dependencies(shared: dict[str, str], client: dict[str, str]) -> None:
    repo = COMPONENTS["cloud-client-api"].path
    update_json_dependency(repo / "package.json", "@openleash/shared", shared["version"])
    update_json_dependency(repo / "package.json", "@openleash/client-api", client["version"])
    dockerfile = repo / "Dockerfile"
    replace_regex(dockerfile, r"ARG OPENLEASH_SHARED_REF=[a-f0-9]{40}", f"ARG OPENLEASH_SHARED_REF={shared['commit']}")
    replace_regex(dockerfile, r"ARG OPENLEASH_CLIENT_API_REF=[a-f0-9]{40}", f"ARG OPENLEASH_CLIENT_API_REF={client['commit']}")
    replace_regex(dockerfile, r"value\.dependencies\['@openleash/shared'\]='[^']+'", f"value.dependencies['@openleash/shared']='{shared['version']}'")
    replace_regex(dockerfile, r"value\.dependencies\['@openleash/client-api'\]='[^']+'", f"value.dependencies['@openleash/client-api']='{client['version']}'")


def pin_desktop_shared(version: str) -> None:
    repo = COMPONENTS["desktop-client"].path
    update_json_dependency(repo / "package.json", "@openleash/shared", version)
    for workflow in ("release-macos.yml", "release-windows.yml", "release-terminal-macos.yml"):
        replace_regex(repo / ".github/workflows" / workflow, r"ref: v[0-9]+\.[0-9]+\.[0-9]+", f"ref: v{version}")


def bump_component_version(component: Component, version: str) -> None:
    package = component.path / "package.json"
    cargo = component.path / "Cargo.toml"
    pubspec = component.path / "pubspec.yaml"
    if package.exists():
        data = json.loads(package.read_text(encoding="utf-8"))
        data["version"] = version
        package.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    elif cargo.exists():
        replace_regex(cargo, r'^version\s*=\s*"[^"]+"', f'version = "{version}"', flags=re.MULTILINE)
    elif pubspec.exists():
        replace_regex(pubspec, r"^version:\s*[^\n]+", f"version: {version}+1", flags=re.MULTILINE)


def update_json_dependency(path: Path, name: str, version: str) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    dependencies = data.setdefault("dependencies", {})
    dependencies[name] = version
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def replace_regex(path: Path, pattern: str, replacement: str | Callable[[re.Match[str]], str], flags: int = 0) -> None:
    source = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, source, flags=flags)
    if count == 0:
        raise RuntimeError(f"Release pin pattern was not found in {path.relative_to(ROOT)}: {pattern}")
    path.write_text(updated, encoding="utf-8")


def commit_and_push_root_pins(message: str) -> dict[str, str]:
    paths = ["scripts/install-openleash-personal.sh", "deploy/docker/individual-open-source.compose.yml"]
    git(ROOT, "add", "--", *paths)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 1:
        git(ROOT, "commit", "-m", message)
        git(ROOT, "push", "origin", "HEAD:main")
    return {"commit": git(ROOT, "rev-parse", "HEAD").strip()}


def smoke_personal_image(version: str, digest: str) -> dict[str, str]:
    image = f"ghcr.io/open-leash/client-api:{version}@{digest}"
    run_command(("bash", "scripts/smoke-personal-release.sh", image), ROOT)
    return {"image": image}


def run_cloud_migrations(args: argparse.Namespace, action: str) -> dict[str, str]:
    command = ["python3", "migrate.py", "--target", args.migration_target, "--scope", "all", f"--{action}", "--yes"]
    state_path = Path(getattr(args, "release_state_path", ACTIVE_STATE_PATH or STATE_DIR / "manual-release.json"))
    log_dir = state_path.parent / "migration-logs" / state_path.stem
    command.extend(("--log-dir", str(log_dir)))
    if args.database_url:
        command.extend(("--database-url", args.database_url))
    run_command(tuple(command), ROOT)
    return {"target": args.migration_target, "action": action, "log_dir": str(log_dir)}


def resolve_migration_database(args: argparse.Namespace) -> str:
    if args.database_url:
        return args.database_url
    if args.migration_target == "custom":
        raise RuntimeError("--migration-target custom requires --database-url")
    for key in ("OPENLEASH_GCP_DATABASE_URL", "OPENLEASH_CLOUD_SQL_DATABASE_URL", "CLOUD_SQL_DATABASE_URL", "GCP_DATABASE_URL"):
        if os.environ.get(key):
            return os.environ[key]
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() in {"OPENLEASH_GCP_DATABASE_URL", "OPENLEASH_CLOUD_SQL_DATABASE_URL", "CLOUD_SQL_DATABASE_URL", "GCP_DATABASE_URL"} and value.strip():
                return value.strip().strip("\"'")
    raise RuntimeError("Cloud deployment requires a production database URL for backup and migrations.")


def verify_desktop_release(repo: str, version: str, terminal: bool) -> None:
    release = fetch_json(f"https://api.github.com/repos/{repo}/releases/tags/v{version}")
    if release.get("draft"):
        raise RuntimeError(f"Desktop v{version} is still a draft")
    assets = {asset.get("name"): asset for asset in release.get("assets", [])}
    expected = (
        {f"Leash-{version}-terminal-installer-arm64.dmg", "install-openleash-personal-terminal.sh", "SHA256SUMS-TERMINAL"}
        if terminal else
        {f"Leash-{version}-arm64.dmg", f"Leash-{version}-x64-Setup.exe", "install-openleash-personal.sh", "SHA256SUMS", "SHA256SUMS-WINDOWS"}
    )
    missing = expected - set(assets)
    if missing:
        raise RuntimeError(f"Desktop release v{version} is missing: {', '.join(sorted(missing))}")
    for name in expected:
        if int(assets[name].get("size") or 0) <= 0:
            raise RuntimeError(f"Desktop release asset is empty: {name}")


def verify_live_installer(main_web_url: str, expected_version: str | None) -> dict[str, str]:
    url = f"{main_web_url.rstrip('/')}/install.sh?release_verify={int(time.time())}"
    script = fetch_bytes(url).decode("utf-8")
    if expected_version and f'OPENLEASH_DESKTOP_VERSION="${{OPENLEASH_DESKTOP_VERSION:-{expected_version}}}"' not in script:
        raise RuntimeError(f"Live install.sh does not select desktop v{expected_version}")
    env = os.environ.copy()
    env["OPENLEASH_INSTALL_VERIFY_ONLY"] = "1"
    completed = subprocess.run(["bash"], input=script, text=True, capture_output=True, env=env)
    if completed.returncode != 0 or "Verified installer and DMG checksums." not in completed.stdout:
        raise RuntimeError(f"Live install.sh verification failed: {completed.stderr.strip()}")
    print(completed.stdout.strip())
    return {"url": url, "sha256": hashlib.sha256(script.encode()).hexdigest()}


def wait_for_live_installer(main_web_url: str, expected_version: str | None, timeout: int) -> dict[str, str]:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            return verify_live_installer(main_web_url, expected_version)
        except (RuntimeError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(5)
    raise RuntimeError(f"Timed out waiting for the live installer: {last_error}")


def wait_for_web_health(url: str, timeout: int) -> dict[str, str]:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            request = urllib.request.Request(
                f"{url.rstrip('/')}?release_verify={int(time.time())}",
                headers={"User-Agent": "leash-release-pipeline", "Cache-Control": "no-cache"},
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status != 200:
                    raise RuntimeError(f"Unexpected HTTP {response.status} from {url}")
                return {"url": response.geturl(), "status": str(response.status)}
        except (RuntimeError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(5)
    raise RuntimeError(f"Timed out waiting for dashboard web: {last_error}")


def verify_json_health(url: str, service: str, expected_version: str | None = None) -> dict[str, Any]:
    payload = fetch_json(f"{url}?release_verify={int(time.time())}")
    if payload.get("ok") is not True or payload.get("service") != service:
        raise RuntimeError(f"Unexpected health response from {url}: {payload}")
    if expected_version is not None and payload.get("version") != expected_version:
        raise RuntimeError(
            f"{service} is healthy but has version {payload.get('version')!r}; expected newly released {expected_version!r}"
        )
    return payload


def wait_for_json_health(url: str, service: str, expected_version: str, timeout: int) -> dict[str, Any]:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            return verify_json_health(url, service, expected_version)
        except (RuntimeError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(5)
    raise RuntimeError(f"Timed out waiting for {service} {expected_version}: {last_error}")


def current_release_identity(component: Component) -> dict[str, str]:
    commit = git(component.path, "rev-parse", "origin/main").strip()
    top_level = Path(git(component.path, "rev-parse", "--show-toplevel").strip()).resolve()
    package_path = "package.json"
    if top_level == ROOT.resolve() and component.path.resolve() != ROOT.resolve():
        package_path = f"{component.path.resolve().relative_to(ROOT.resolve()).as_posix()}/package.json"
    package_text = git(component.path, "show", f"origin/main:{package_path}", check=False)
    version = str(json.loads(package_text)["version"]) if package_text.strip() else component_version(component)
    return {"version": version, "commit": commit}


def component_version(component: Component) -> str:
    package = component.path / "package.json"
    cargo = component.path / "Cargo.toml"
    pubspec = component.path / "pubspec.yaml"
    if package.exists():
        return str(json.loads(package.read_text(encoding="utf-8"))["version"])
    source = (cargo if cargo.exists() else pubspec).read_text(encoding="utf-8")
    pattern = r'^version\s*=\s*"([^"]+)"' if cargo.exists() else r"^version:\s*([0-9]+\.[0-9]+\.[0-9]+)"
    match = re.search(pattern, source, re.MULTILINE)
    if not match:
        raise RuntimeError(f"Could not read version for {component.key}")
    return match.group(1)


def next_patch(version: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", version)
    if not match:
        raise SystemExit(f"Cannot bump non-semver version: {version}")
    major, minor, patch = (int(value) for value in match.groups())
    return f"{major}.{minor}.{patch + 1}"


def validate_version(version: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Production releases require a stable x.y.z semantic version: {version}")


def semver_core(version: str) -> tuple[int, int, int]:
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)", version)
    if not match:
        raise RuntimeError(f"Invalid semantic version: {version}")
    return tuple(int(value) for value in match.groups())


def ensure_tag(component: Component, version: str) -> None:
    tag = component_tag(component, version)
    current = git(component.path, "rev-parse", "HEAD").strip()
    existing = git(component.path, "rev-list", "-n", "1", tag, check=False).strip()
    if existing:
        if existing != current:
            raise RuntimeError(f"{component.github} {tag} already points to {existing}, not {current}")
        return
    git(component.path, "tag", "-a", tag, "-m", f"Release {component.key} {version}")


def component_tag(component: Component, version: str) -> str:
    if component.key == "desktop-client" or component.key.startswith("cloud-") or component.key == "main-web":
        return f"v{version}"
    prefix = "engine" if component.key == "client-api" else component.key
    return f"{prefix}-v{version}"


def ensure_github_release(repo: str, version: str, prerelease: bool) -> None:
    exists = subprocess.run(["gh", "release", "view", f"v{version}", "--repo", repo], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if exists:
        return
    command = ["gh", "release", "create", f"v{version}", "--repo", repo, "--verify-tag", "--title", f"Leash {version}", "--generate-notes"]
    if prerelease:
        command.append("--prerelease")
    run_command(tuple(command), ROOT)


def run_command(command: tuple[str, ...], cwd: Path) -> None:
    rendered = " ".join(redact(argument) for argument in command)
    print(f"[release:run] ({cwd.relative_to(ROOT) if cwd != ROOT else '.'}) {rendered}")
    subprocess.run(list(command), cwd=cwd, check=True)


def capture(command: tuple[str, ...] | list[str], cwd: Path) -> str:
    completed = subprocess.run(list(command), cwd=cwd, text=True, capture_output=True)
    if completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, command, completed.stdout, completed.stderr)
    return completed.stdout


def git(repo: Path, *arguments: str, check: bool = True) -> str:
    command = ["git", *arguments]
    retryable = bool(arguments and arguments[0] in {"fetch", "ls-remote"})
    attempts = 3 if retryable else 1
    completed: subprocess.CompletedProcess[str] | None = None
    for attempt in range(1, attempts + 1):
        completed = subprocess.run(command, cwd=repo, text=True, capture_output=True)
        if completed.returncode == 0:
            return completed.stdout
        diagnostic = f"{completed.stdout}\n{completed.stderr}"
        if (
            not check
            or attempt == attempts
            or not TRANSIENT_GIT_ERROR_PATTERN.search(diagnostic)
        ):
            break
        delay = attempt
        print(
            f"[release:retry] transient GitHub failure during {' '.join(command)}; "
            f"retrying in {delay}s ({attempt + 1}/{attempts})",
            file=sys.stderr,
        )
        time.sleep(delay)
    assert completed is not None
    if check and completed.returncode != 0:
        if completed.stdout:
            print(completed.stdout.rstrip(), file=sys.stderr)
        if completed.stderr:
            print(completed.stderr.rstrip(), file=sys.stderr)
        raise subprocess.CalledProcessError(
            completed.returncode,
            command,
            completed.stdout,
            completed.stderr,
        )
    return completed.stdout


def fetch_json(url: str) -> dict[str, Any]:
    return json.loads(fetch_bytes(url))


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "leash-release-pipeline", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def redact(value: str) -> str:
    if value.startswith(("postgres://", "postgresql://")):
        return re.sub(r"://([^:]+):[^@]+@", r"://\1:****@", value)
    return value


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError, urllib.error.URLError) as error:
        print(f"\n[release] failed: {error}", file=sys.stderr)
        if ACTIVE_STATE_PATH and ACTIVE_STATE_PATH.exists():
            print(
                f"[release] resume safely with: ./release.py --production --resume {ACTIVE_STATE_PATH} --ship --yes",
                file=sys.stderr,
            )
        raise SystemExit(1)
