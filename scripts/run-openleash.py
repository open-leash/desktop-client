#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DESKTOP_CLIENT = ROOT / "apps" / "desktop-client"
DESKTOP_DEV_APP = DESKTOP_CLIENT / ".dev" / "OpenLeash.app"
DESKTOP_DEV_EXECUTABLE = DESKTOP_DEV_APP / "Contents" / "MacOS" / "OpenLeash"
DATABASE_URL = "postgres://openleash:openleash@localhost:9543/openleash"
LOCAL_PLUGIN_CATALOG_API_URL = "http://127.0.0.1:9338"
DEFAULT_PLUGINS_DIR = ROOT / "apps" / "client-api" / "src" / "plugins"
EVENT_PLUGIN_SPECS = [
    ("openleash.blast-radius", "blast-radius", "1.0.2", 9351),
    ("openleash.sensitive-access", "sensitive-access", "1.0.0", 9352),
    ("openleash.dlp", "data-leakage-prevention", "1.0.0", 9353),
    ("openleash.rules-enforcer", "rules-enforcer", "1.0.0", 9354),
    ("openleash.mcp-scanner", "mcp-scanner", "1.0.0", 9355),
    ("openleash.code-scanner", "code-scanner", "1.0.0", 9356),
    ("openleash.skill-scanner", "skill-scanner", "1.0.2", 9357),
    ("openleash.siem-exporter", "siem-exporter", "1.0.0", 9358),
]
DEV_PLUGIN_RUNTIME_SECRET = "openleash-local-plugin-secret"
DESKTOP_DEV_RUNTIME_ENV = {
    "OPENLEASH_UPDATE_MODE": "disabled",
    "OPENLEASH_INSTALL_MODE": "development",
}
DEV_PLUGIN_ENDPOINTS = json.dumps({plugin_id: f"http://127.0.0.1:{port}" for plugin_id, _, _, port in EVENT_PLUGIN_SPECS})
PIPELINE_TRACE_FILE = ROOT / "output" / "openleash-flow.ndjson"
DEV_COMPOSE = ["docker", "compose", "--project-name", "openleash-dev"]
RUN_ALIASES_LEGACY_PATH = Path.home() / ".openleash" / "run-aliases.json"
RUN_ALIASES_PATH = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "openleash" / "run-aliases.json"
DEFAULT_RUN_ALIASES = [
    {
        "name": "local public cloud api, fresh, real oauth, with desktop client",
        "config": {
            "mode_key": "public-cloud",
            "reset": "clean-slate",
            "clean_slate": True,
            "dev_auth": False,
            "load_plugins": True,
            "plugins_dir": str(DEFAULT_PLUGINS_DIR),
            "desktop_api_url": None,
        },
    },
    {
        "name": "local public cloud full stack, fresh, real oauth, with desktop client",
        "config": {
            "mode_key": "public-cloud-full",
            "reset": "clean-slate",
            "clean_slate": True,
            "dev_auth": False,
            "load_plugins": True,
            "plugins_dir": str(DEFAULT_PLUGINS_DIR),
            "desktop_api_url": None,
        },
    },
    {
        "name": "individual open source local stack, reset data, dev auth",
        "config": {
            "mode_key": "individual-open-source",
            "reset": "data",
            "clean_slate": False,
            "dev_auth": True,
            "load_plugins": True,
            "plugins_dir": str(DEFAULT_PLUGINS_DIR),
            "desktop_api_url": None,
        },
    },
    {
        "name": "local private cloud desktop stack, reset data, dev auth",
        "config": {
            "mode_key": "private-cloud",
            "reset": "data",
            "clean_slate": False,
            "dev_auth": True,
            "load_plugins": False,
            "plugins_dir": str(DEFAULT_PLUGINS_DIR),
            "desktop_api_url": None,
        },
    },
]
USER_MODE_ALIASES = {
    "individual-open-source": "individual-open-source",
    "individual-cloud-byok": "public-cloud",
    "individual-cloud-managed": "public-cloud",
    "org-private-cloud": "private-cloud",
    "org-cloud-byok": "public-cloud",
    "org-cloud-managed": "public-cloud",
    "public-cloud-full": "public-cloud-full",
    "private-cloud-full": "private-cloud-full",
    "public-cloud": "public-cloud",
    "private-cloud": "private-cloud",
}
USER_MODE_LABELS = {
    "individual-open-source": "Individual Open Source",
    "individual-cloud-byok": "Individual Cloud - Your LLM Key",
    "individual-cloud-managed": "Individual Cloud - Fully Managed",
    "org-private-cloud": "Org Private Cloud",
    "org-cloud-byok": "Org Cloud - Your LLM Key",
    "org-cloud-managed": "Org Cloud - Fully Managed",
    "public-cloud-full": "OpenLeash Cloud full stack",
    "private-cloud-full": "Private Cloud full stack",
    "public-cloud": "OpenLeash Cloud dev stack",
    "private-cloud": "Private Cloud dev stack",
    "desktop-public": "Desktop -> api.openleash.com",
    "desktop-custom": "Desktop -> custom API",
}
USER_MODE_DETAILS = {
    "individual-open-source": "desktop tests local Docker client-api + Postgres; no cloud sign-in",
    "individual-cloud-byok": "desktop tests solo cloud sign-in; user enters their LLM key",
    "individual-cloud-managed": "desktop tests solo cloud sign-in; OpenLeash supplies evaluation",
    "org-private-cloud": "desktop + private APIs + dashboard; customer-hosted org",
    "org-cloud-byok": "desktop + cloud APIs + dashboard; org enters its LLM key",
    "org-cloud-managed": "desktop + cloud APIs + dashboard; OpenLeash supplies evaluation",
    "public-cloud-full": "main web + cloud APIs + cloud dashboard + desktop",
    "private-cloud-full": "main web + private APIs + dashboard + desktop",
    "public-cloud": "cloud APIs + cloud dashboard + desktop, no main web",
    "private-cloud": "private APIs + dashboard + desktop, no main web",
    "desktop-public": "desktop only, aimed at api.openleash.com",
    "desktop-custom": "desktop only, aimed at any managed API URL",
}
DESKTOP_GOOGLE_REDIRECT_URI = "http://localhost:9317/v1/auth/google/callback"
DESKTOP_MICROSOFT_REDIRECT_URI = "http://localhost:9317/v1/auth/microsoft/callback"
WEB_GOOGLE_REDIRECT_URI = "http://localhost:9319/v1/auth/google/callback"
WEB_MICROSOFT_REDIRECT_URI = "http://localhost:9319/v1/auth/microsoft/callback"
DOTENV = {}


@dataclass(frozen=True)
class Command:
    name: str
    args: list[str]
    env: dict[str, str] = field(default_factory=dict)
    cwd: Path = ROOT


@dataclass(frozen=True)
class Mode:
    key: str
    label: str
    description: str
    needs_db: bool
    before: list[Command]
    processes: list[Command]
    urls: list[tuple[str, str]]
    ready_urls: list[tuple[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class RunChoice:
    mode: Mode | None
    reset: str
    cleanup_only: bool = False
    clean_slate: bool = False
    load_plugins: bool = False
    plugins_dir: Path = DEFAULT_PLUGINS_DIR
    desktop_api_url: str | None = None
    dev_auth: bool = False


@dataclass(frozen=True)
class QuestionnaireChoice:
    mode_key: str | None
    reset: str
    requested_mode_key: str | None = None
    cleanup_only: bool = False
    clean_slate: bool = False
    dev_auth: bool = False
    load_plugins: bool = False
    plugins_dir: Path = DEFAULT_PLUGINS_DIR
    desktop_api_url: str | None = None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run OpenLeash in a Product.md-aligned Individual Open Source, OpenLeash Cloud, or Private Cloud stack."
    )
    parser.add_argument("--mode", choices=list(USER_MODE_ALIASES.keys()), help="Mode to run without prompting.")
    parser.add_argument("--reset-data", action="store_true", help="Clear local database tenant/runtime data before starting.")
    parser.add_argument("--reset-all", action="store_true", help="Clear all local database data, including policies, before starting.")
    parser.add_argument("--clean-slate", action="store_true", help="Remove local OpenLeash state, hooks, app install, and dev database, then start the selected mode.")
    parser.add_argument("--keep-local", action="store_true", help="Do not clean local OpenLeash state before starting. By default runs start clean.")
    parser.add_argument(
        "--clean",
        "--cleanup-local",
        dest="cleanup_local",
        action="store_true",
        help="Clean everything local to OpenLeash: services, desktop client state/app, hooks, proxy, Compose containers, and Postgres data.",
    )
    parser.add_argument("--desktop-only", action="store_true", help="Build and run only the desktop client, without Docker, Postgres, local APIs, dashboard, or docs.")
    parser.add_argument("--real-oauth", action="store_true", help="Deprecated compatibility flag. Real OAuth is the default.")
    parser.add_argument("--dev-auth", action="store_true", help="Use the local dev-auth shortcut instead of real OAuth.")
    parser.add_argument("--api-url", "--desktop-api-url", dest="desktop_api_url", help="Managed API URL for the desktop client, for example https://api.openleash.com.")
    parser.add_argument("--load-plugins", action="store_true", help="Load plugin manifests from the plugins folder into the plugin catalog database.")
    parser.add_argument("--plugins-dir", default=str(DEFAULT_PLUGINS_DIR), help="Plugin folder to import when --load-plugins is set.")
    parser.add_argument("--yes", action="store_true", help="Skip the final confirmation prompt.")
    parser.add_argument("--dry-run", action="store_true", help="Print the resolved mode and commands without changing local state or starting services.")
    parser.add_argument("--view-flow", action="store_true", help="Start or open the local flow-viewer web app.")
    parser.add_argument("--no-open-flow-viewer", action="store_true", help="Do not automatically open the flow viewer for Individual Open Source runs.")
    args = parser.parse_args()

    if args.view_flow:
        return run_flow_viewer()

    DOTENV.update(load_env_file(ROOT / ".env"))
    DOTENV.setdefault("OPENLEASH_LOCAL_PROXY_IMAGE", "openleash-local-proxy:dev")
    if args.real_oauth and args.dev_auth:
        print("[openleash] choose either --real-oauth or --dev-auth, not both", file=sys.stderr)
        return 2
    if args.desktop_only:
        args.clean_slate = should_clean_slate(args)
        return run_desktop_only(args)

    if args.cleanup_local:
        print_replay_command(None, "cleanup", args.dev_auth, cleanup_only=True)
        if not args.yes:
            print("This permanently deletes the local OpenLeash Postgres database and all local OpenLeash client state.")
            if not confirm("Clean everything local to OpenLeash?", default=False):
                cancel()
        cleanup_local_openleash()
        return 0

    if args.load_plugins and not args.mode:
        print_plugin_load_header(Path(args.plugins_dir))
        run_step(Command("postgres", [*DEV_COMPOSE, "up", "-d", "--wait", "postgres"]))
        run_step(core_migrate_command())
        load_plugins_from_folder(Path(args.plugins_dir))
        print("[openleash] plugin catalog load complete.")
        return 0

    if args.mode:
        modes = build_modes_for_auth(dev_auth=args.dev_auth, desktop_api_url=args.desktop_api_url, requested_mode_key=args.mode)
        choice = cli_choice(args, modes)
        selected_dev_auth = args.dev_auth
    else:
        questionnaire = choose_run_questionnaire()
        if questionnaire.cleanup_only:
            print_replay_command(None, "cleanup", questionnaire.dev_auth, cleanup_only=True)
            cleanup_local_openleash()
            return 0
        if questionnaire.mode_key is None:
            print("[openleash] no mode selected", file=sys.stderr)
            return 1
        modes = build_modes_for_auth(dev_auth=questionnaire.dev_auth, desktop_api_url=questionnaire.desktop_api_url, requested_mode_key=questionnaire.requested_mode_key or questionnaire.mode_key)
        choice = RunChoice(
            mode=modes[questionnaire.mode_key],
            reset=questionnaire.reset,
            clean_slate=questionnaire.clean_slate,
            load_plugins=questionnaire.load_plugins,
            plugins_dir=questionnaire.plugins_dir,
            desktop_api_url=questionnaire.desktop_api_url,
            dev_auth=questionnaire.dev_auth,
        )
        selected_dev_auth = questionnaire.dev_auth

    if choice.cleanup_only:
        cleanup_local_openleash()
        return 0
    if choice.mode is None:
        print("[openleash] no mode selected", file=sys.stderr)
        return 1
    mode = choice.mode
    reset = choice.reset

    if mode.key == "individual-open-source":
        PIPELINE_TRACE_FILE.parent.mkdir(parents=True, exist_ok=True)
        PIPELINE_TRACE_FILE.unlink(missing_ok=True)
        print("\n[openleash] Local flow tracing is enabled for this run.")
        print(f"[openleash] Detailed redacted NDJSON: {PIPELINE_TRACE_FILE}")
        print("[openleash] Live compact stages appear below as [openleash:flow].")
        print("[openleash] Reopen viewer anytime: python3 run.py --view-flow")
        print(f"[openleash] Raw follow: tail -f {shlex.quote(str(PIPELINE_TRACE_FILE))}")
        print("[openleash] In the desktop setup, choose the agents to monitor; completing setup installs their hooks and starts/configures local-proxy automatically.")

    desktop_api_url = choice.desktop_api_url or args.desktop_api_url
    print_header(mode, reset, selected_dev_auth, args.load_plugins or choice.load_plugins, choice.plugins_dir if choice.load_plugins else Path(args.plugins_dir), desktop_api_url)

    if args.dry_run:
        for step in mode.before:
            print(f"[openleash:{step.name}] {format_command_with_env(step)}")
        for process in mode.processes:
            print(f"[openleash:{process.name}] {format_command_with_env(process)}")
        print("[openleash] dry run complete; no services or local data were changed.")
        return 0

    children: list[subprocess.Popen[str]] = []

    def stop_children(*_: object) -> None:
        if children:
            print("\n[openleash] stopping services...")
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()

    signal.signal(signal.SIGINT, stop_children)
    signal.signal(signal.SIGTERM, stop_children)

    try:
        if choice.clean_slate:
            cleanup_local_openleash()
        stop_existing_dev_stack(mode)
        if mode.needs_db:
            run_step(Command("postgres", [*DEV_COMPOSE, "up", "-d", "--wait", "postgres"]))
            for migrate_step in local_migration_commands_for_mode(mode):
                run_step(migrate_step)
            if reset != "none" and reset != "clean-slate":
                reset_args = ["npm", "run", "db:reset-data", "--", "--yes"]
                if reset == "all":
                    reset_args.append("--include-policies")
                run_step(Command("reset-data", reset_args, {"DATABASE_URL": DATABASE_URL}))
                for migrate_step in local_migration_commands_for_mode(mode):
                    run_step(migrate_step)
            if args.load_plugins or choice.load_plugins:
                load_plugins_from_folder(choice.plugins_dir if choice.load_plugins else Path(args.plugins_dir))

        if mode.needs_db:
            prepare_event_plugin_containers()

        for step in mode.before:
            run_step(step)

        if any(process.name == "desktop-client" for process in mode.processes):
            run_step(Command("local-proxy-image", ["docker", "build", "-t", DOTENV["OPENLEASH_LOCAL_PROXY_IMAGE"], "apps/local-proxy"]))
            prepare_desktop_dev_app()

        desktop_processes = [process for process in mode.processes if process.name == "desktop-client"]
        service_processes = [process for process in mode.processes if process.name != "desktop-client"]

        for process in service_processes:
            children.append(start_process(process))

        if mode.ready_urls:
            wait_for_ready_urls(mode.ready_urls, children)

        for process in desktop_processes:
            desktop_child = start_process(process)
            children.append(desktop_child)
            wait_for_desktop_ready(desktop_child)

        print_urls(mode)
        if mode.key == "individual-open-source" and not args.no_open_flow_viewer:
            open_flow_viewer_browser()
        print("[openleash] Press Ctrl+C to stop everything.")

        while children:
            for child in list(children):
                code = child.poll()
                if code is not None:
                    children.remove(child)
                    print(f"[openleash] {child.args} exited with {code}; stopping the mode.")
                    stop_children()
                    return code or 0
            signal.pause()
        return 0
    except KeyboardInterrupt:
        stop_children()
        return 130
    except Exception as exc:
        stop_children()
        print(f"[openleash] error: {exc}", file=sys.stderr)
        return 1


def build_modes_for_auth(dev_auth: bool, desktop_api_url: str | None = None, requested_mode_key: str | None = None) -> dict[str, Mode]:
    DOTENV["OPENLEASH_MOBILE_DEV_AUTH"] = "1" if dev_auth else "0"
    account_packages = {
        "individual-cloud-byok": "personal-byok",
        "individual-cloud-managed": "personal-managed",
        "org-cloud-byok": "work-byok",
        "org-cloud-managed": "work-managed",
    }
    requested_package = account_packages.get(requested_mode_key or "")
    if requested_package:
        DOTENV["OPENLEASH_DEV_ACCOUNT_PACKAGE"] = requested_package
    else:
        DOTENV.pop("OPENLEASH_DEV_ACCOUNT_PACKAGE", None)
    return build_modes(desktop_api_url)


def run_desktop_only(args: argparse.Namespace) -> int:
    requested_mode = args.mode or "individual-cloud-managed"
    individual_open_source = requested_mode == "individual-open-source"
    desktop_api_url = args.desktop_api_url or ("http://127.0.0.1:9318" if individual_open_source else "https://api.openleash.com")
    mobile_dev_auth = "1" if args.dev_auth else "0"
    client_mode = "custom" if individual_open_source else "cloud"
    dashboard_url = "" if individual_open_source else (env_value("OPENLEASH_CLOUD_DASHBOARD_URL") or "https://app.openleash.com")
    command = Command("desktop-client", ["env", "-u", "ELECTRON_RUN_AS_NODE", str(DESKTOP_DEV_EXECUTABLE), str(DESKTOP_CLIENT), "--show-window"], {
        **DESKTOP_DEV_RUNTIME_ENV,
        "OPENLEASH_CLIENT_MODE": client_mode,
        "OPENLEASH_CLOUD_API_URL": desktop_api_url,
        "OPENLEASH_CLOUD_DASHBOARD_URL": dashboard_url,
        "OPENLEASH_MOBILE_DEV_AUTH": mobile_dev_auth,
    }, DESKTOP_CLIENT)

    print("\nMode: Desktop only")
    if individual_open_source:
        print("Description: Build and run only the desktop client for the Individual Open Source setup path. The desktop wizard can start local Docker services.")
    else:
        print("Description: Build and run only the desktop client. No Docker, Postgres, local APIs, or dashboard.")
    print(f"Desktop API: {desktop_api_url}")
    print(f"Auth: {'local dev auth' if args.dev_auth else 'real OAuth'}")
    replay = ["python3", "run.py", "--desktop-only"]
    if args.mode:
        replay += ["--mode", args.mode]
    replay += ["--desktop-api-url", desktop_api_url]
    if getattr(args, "keep_local", False):
        replay.append("--keep-local")
    elif args.clean_slate:
        replay.append("--clean-slate")
    if args.dev_auth:
        replay.append("--dev-auth")
    replay.append("--yes")
    print(f"Command: {format_command(replay)}")

    if args.dry_run:
        print(f"[openleash:{command.name}] {format_command_with_env(command)}")
        print("[openleash] dry run complete; no services or local data were changed.")
        return 0

    if args.clean_slate:
        cleanup_local_openleash()
    run_optional_step(Command("stop-desktop-app", ["pkill", "-TERM", "-f", "/OpenLeash.app/"]))
    terminate_listeners_on_port(9317)
    run_step(Command("desktop-build", ["npm", "run", "build", "-w", "@openleash/desktop-client"]))
    prepare_desktop_dev_app()

    child = start_process(command)
    wait_for_desktop_ready(child)

    def stop_child(*_: object) -> None:
        if child.poll() is None:
            print("\n[openleash] stopping desktop client...")
            child.terminate()
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()

    signal.signal(signal.SIGINT, stop_child)
    signal.signal(signal.SIGTERM, stop_child)
    print("[openleash] Desktop API will listen on http://127.0.0.1:9317")
    print("[openleash] Press Ctrl+C to stop desktop.")
    try:
        return child.wait()
    except KeyboardInterrupt:
        stop_child()
        return 130


def build_modes(desktop_api_url: str | None = None) -> dict[str, Mode]:
    cloud_mobile_dev_auth = env_value("OPENLEASH_MOBILE_DEV_AUTH") or "1"
    individual_desktop_api_url = desktop_api_url or "http://127.0.0.1:9318"
    cloud_desktop_api_url = desktop_api_url or "http://127.0.0.1:9318"
    private_desktop_api_url = desktop_api_url or "http://127.0.0.1:9318"
    individual_common = {
        "DATABASE_URL": DATABASE_URL,
        "OPENLEASH_DEPLOYMENT_MODE": "individual-open-source",
        "OPENLEASH_DEV_TOKEN": "openleash-individual-local-dev-token",
        "OPENLEASH_DEV_ORG_SLUG": "individual-open-source",
        "OPENLEASH_RELEASE_ADMIN_TOKEN": "local-release-admin-token",
        "OPENLEASH_MOBILE_DEV_AUTH": env_value("OPENLEASH_MOBILE_DEV_AUTH") or "1",
        "OPENLEASH_GOOGLE_REDIRECT_URI": DESKTOP_GOOGLE_REDIRECT_URI,
        "OPENLEASH_MICROSOFT_REDIRECT_URI": DESKTOP_MICROSOFT_REDIRECT_URI,
        "OPENLEASH_GOOGLE_WEB_REDIRECT_URI": WEB_GOOGLE_REDIRECT_URI,
        "OPENLEASH_MICROSOFT_WEB_REDIRECT_URI": WEB_MICROSOFT_REDIRECT_URI,
        "OPENLEASH_PIPELINE_TRACE": "1",
        "OPENLEASH_PIPELINE_TRACE_FILE": str(PIPELINE_TRACE_FILE),
        "OPENLEASH_PLUGIN_ENDPOINTS": DEV_PLUGIN_ENDPOINTS,
        "OPENLEASH_PLUGIN_RUNTIME_SECRET": DEV_PLUGIN_RUNTIME_SECRET,
    }
    individual_catalog_common = {
        **individual_common,
        "OPENLEASH_DEPLOYMENT_MODE": "cloud",
        "OPENLEASH_TENANT_DOMAIN": "openleash.com",
        "OPENLEASH_CLOUD_BOOTSTRAP_TOKEN": "local-cloud-bootstrap",
    }
    private_common = {
        "DATABASE_URL": DATABASE_URL,
        "OPENLEASH_DEPLOYMENT_MODE": "private",
        "OPENLEASH_DEV_ORG_SLUG": "self-hosted",
        "OPENLEASH_PRIVATE_BOOTSTRAP_TOKEN": "local-private-bootstrap",
        "OPENLEASH_RELEASE_ADMIN_TOKEN": "local-release-admin-token",
        "OPENLEASH_MOBILE_DEV_AUTH": env_value("OPENLEASH_MOBILE_DEV_AUTH") or "1",
        "OPENLEASH_GOOGLE_REDIRECT_URI": DESKTOP_GOOGLE_REDIRECT_URI,
        "OPENLEASH_MICROSOFT_REDIRECT_URI": DESKTOP_MICROSOFT_REDIRECT_URI,
        "OPENLEASH_GOOGLE_WEB_REDIRECT_URI": WEB_GOOGLE_REDIRECT_URI,
        "OPENLEASH_MICROSOFT_WEB_REDIRECT_URI": WEB_MICROSOFT_REDIRECT_URI,
        "IDENTITY_LOADER_URL": "http://localhost:9321",
        "OPENLEASH_PLUGIN_ENDPOINTS": DEV_PLUGIN_ENDPOINTS,
        "OPENLEASH_PLUGIN_RUNTIME_SECRET": DEV_PLUGIN_RUNTIME_SECRET,
    }
    cloud_common = {
        "DATABASE_URL": DATABASE_URL,
        "OPENLEASH_DEPLOYMENT_MODE": "cloud",
        "OPENLEASH_TENANT_DOMAIN": "openleash.com",
        "OPENLEASH_RELEASE_ADMIN_TOKEN": "local-release-admin-token",
        "OPENLEASH_CLOUD_BOOTSTRAP_TOKEN": "local-cloud-bootstrap",
        "OPENLEASH_MOBILE_DEV_AUTH": cloud_mobile_dev_auth,
        "OPENLEASH_DEV_ACCOUNT_PACKAGE": env_value("OPENLEASH_DEV_ACCOUNT_PACKAGE") or "work-managed",
        # Use a realistic work identity so the development sign-in exercises
        # new-tenant discovery and onboarding instead of falling into the
        # legacy openleash.com seed organization.
        "OPENLEASH_MOBILE_DEV_EMAIL": env_value("OPENLEASH_MOBILE_DEV_EMAIL") or "security.admin@acme.example",
        "OPENLEASH_MOBILE_DEV_NAME": env_value("OPENLEASH_MOBILE_DEV_NAME") or "Avery Chen",
        "OPENLEASH_GOOGLE_REDIRECT_URI": DESKTOP_GOOGLE_REDIRECT_URI,
        "OPENLEASH_MICROSOFT_REDIRECT_URI": DESKTOP_MICROSOFT_REDIRECT_URI,
        "OPENLEASH_GOOGLE_WEB_REDIRECT_URI": WEB_GOOGLE_REDIRECT_URI,
        "OPENLEASH_MICROSOFT_WEB_REDIRECT_URI": WEB_MICROSOFT_REDIRECT_URI,
        "IDENTITY_LOADER_URL": "http://localhost:9321",
        "OPENLEASH_PLUGIN_ENDPOINTS": DEV_PLUGIN_ENDPOINTS,
        "OPENLEASH_PLUGIN_RUNTIME_SECRET": DEV_PLUGIN_RUNTIME_SECRET,
    }
    identity_loader_env = {
        "DATABASE_URL": DATABASE_URL,
        "ASPNETCORE_URLS": "http://localhost:9321",
        "ASPNETCORE_ENVIRONMENT": "Development",
        "DOTNET_ROLL_FORWARD": "Major",
        "OPENLEASH_IDENTITY_LOADER_DEV_MOCK": env_value("OPENLEASH_IDENTITY_LOADER_DEV_MOCK") or "1",
    }
    cloud_main_web_env = {
        **cloud_common,
        "OPENLEASH_MAIN_WEB_PORT": "9305",
        "NEXT_PUBLIC_CLOUD_CLIENT_API_URL": "http://localhost:9318",
        "NEXT_PUBLIC_CLOUD_DASHBOARD_API_URL": "http://localhost:9319",
        "NEXT_PUBLIC_OPENLEASH_API_URL": "http://localhost:9318",
        "NEXT_PUBLIC_DASHBOARD_URL": "http://localhost:9302",
    }
    private_main_web_env = {
        **private_common,
        "OPENLEASH_MAIN_WEB_PORT": "9305",
        "NEXT_PUBLIC_CLOUD_CLIENT_API_URL": "http://localhost:9318",
        "NEXT_PUBLIC_CLOUD_DASHBOARD_API_URL": "http://localhost:9319",
        "NEXT_PUBLIC_OPENLEASH_API_URL": "http://localhost:9318",
        "NEXT_PUBLIC_DASHBOARD_URL": "http://localhost:9301",
    }

    return {
        "individual-open-source": Mode(
            key="individual-open-source",
            label="Individual Open Source",
            description="Local open-source single-user stack: core client-api, Postgres, and desktop client. No OpenLeash Cloud sign-in or dashboard.",
            needs_db=True,
            before=[
                Command("seed-local-user", [
                    "npm", "run", "db:create-org", "--",
                    "--name", "Individual Open Source",
                    "--slug", "individual-open-source",
                    "--mode", "private",
                ], individual_common),
                Command("desktop-build", ["npm", "run", "build", "-w", "@openleash/desktop-client"])
            ],
            processes=[
                Command("flow-viewer", ["node", "server.mjs"], {
                    "OPENLEASH_PIPELINE_TRACE_FILE": str(PIPELINE_TRACE_FILE),
                    "OPENLEASH_FLOW_VIEWER_PORT": "9340",
                }, ROOT / "apps" / "flow-viewer"),
                Command("client-api", ["npx", "tsx", "src/server.ts"], {
                    **individual_common,
                    "OPENLEASH_API_PORT": "9318",
                    "OPENLEASH_API_SURFACE": "client",
                }, ROOT / "apps" / "client-api"),
                Command("cloud-client-api-catalog", ["npx", "tsx", "src/server.ts"], {
                    **individual_catalog_common,
                    "OPENLEASH_API_PORT": "9338",
                    "OPENLEASH_CLOUD_CLIENT_API_PORT": "9338",
                    "OPENLEASH_API_SURFACE": "client",
                }, ROOT / "apps" / "cloud-client-api"),
                Command("desktop-client", ["env", "-u", "ELECTRON_RUN_AS_NODE", str(DESKTOP_DEV_EXECUTABLE), str(DESKTOP_CLIENT), "--show-window"], {
                    **DESKTOP_DEV_RUNTIME_ENV,
                    "OPENLEASH_CLIENT_MODE": "custom",
                    "OPENLEASH_DEV_TOKEN": individual_common["OPENLEASH_DEV_TOKEN"],
                    "OPENLEASH_CLOUD_API_URL": individual_desktop_api_url,
                    "OPENLEASH_CLOUD_DASHBOARD_URL": "",
                    "OPENLEASH_PUBLIC_PLUGIN_CATALOG_API_URL": LOCAL_PLUGIN_CATALOG_API_URL,
                    "OPENLEASH_MOBILE_DEV_AUTH": individual_common["OPENLEASH_MOBILE_DEV_AUTH"],
                    "OPENLEASH_PIPELINE_TRACE": "1",
                    "OPENLEASH_PIPELINE_TRACE_FILE": str(PIPELINE_TRACE_FILE),
                    "OPENLEASH_PLUGIN_RUNTIME_SECRET": DEV_PLUGIN_RUNTIME_SECRET,
                    "OPENLEASH_PLUGIN_GATEWAY_IMAGE": "openleash/plugin-gateway:dev",
                    "OPENLEASH_DEV_PLUGIN_IMAGES": "1",
                }, DESKTOP_CLIENT),
            ],
            urls=[
                ("flow-viewer", "http://127.0.0.1:9340"),
                ("Local client API", "http://localhost:9318/health"),
                ("Public plugin catalog API", f"{LOCAL_PLUGIN_CATALOG_API_URL}/cloud/health"),
            ],
            ready_urls=[
                ("flow-viewer", "http://127.0.0.1:9340/healthz"),
                ("Local client API", "http://localhost:9318/health"),
                ("Public plugin catalog API", f"{LOCAL_PLUGIN_CATALOG_API_URL}/cloud/health"),
            ],
        ),
        "public-cloud-full": Mode(
            key="public-cloud-full",
            label="OpenLeash Cloud Full Stack",
            description="Full local public-cloud simulation: main web, cloud APIs, cloud dashboard web, identity loader, and desktop client.",
            needs_db=True,
            before=[
                Command("client-api-build", ["npm", "run", "build", "-w", "@openleash/client-api"]),
                Command("seed-org", [
                    "npm", "run", "db:create-org", "--",
                    "--name", "OpenLeash Cloud Dev",
                    "--slug", "openleash-cloud",
                    "--mode", "cloud",
                    "--setup-completed", "false",
                    "--current-step", "1",
                ], cloud_common),
                Command("desktop-build", ["npm", "run", "build", "-w", "@openleash/desktop-client"])
            ],
            processes=[
                Command("identity-loader", ["dotnet", "run", "--no-launch-profile"], identity_loader_env, ROOT / "IdentityLoader" / "IdentityLoader"),
                Command("cloud-client-api", ["npx", "tsx", "src/server.ts"], {
                    **cloud_common,
                    "OPENLEASH_API_PORT": "9318",
                    "OPENLEASH_CLOUD_CLIENT_API_PORT": "9318",
                    "OPENLEASH_API_SURFACE": "client",
                }, ROOT / "apps" / "cloud-client-api"),
                Command("cloud-dashboard-api", ["npx", "tsx", "src/server.ts"], {
                    **cloud_common,
                    "OPENLEASH_API_PORT": "9319",
                    "OPENLEASH_CLOUD_DASHBOARD_API_PORT": "9319",
                    "OPENLEASH_API_SURFACE": "dashboard",
                    "OPENLEASH_PUBLIC_API_URL": "http://localhost:9319",
                }, ROOT / "apps" / "cloud-dashboard-api"),
                Command("cloud-dashboard-web", ["npm", "--prefix", "apps/cloud-dashboard-web", "run", "dev"], {
                    **cloud_common,
                    "OPENLEASH_CLOUD_DASHBOARD_PORT": "9302",
                    "OPENLEASH_DASHBOARD_URL": "http://localhost:9302",
                    "NEXT_PUBLIC_DASHBOARD_URL": "http://localhost:9302",
                    "OPENLEASH_API_URL": "http://localhost:9319",
                    "NEXT_PUBLIC_OPENLEASH_API_URL": "http://localhost:9319",
                    "NEXT_PUBLIC_OPENLEASH_CLOUD_DASHBOARD_API_URL": "http://localhost:9319",
                }),
                Command("main-web", ["npm", "run", "dev:main-web"], cloud_main_web_env),
                Command("desktop-client", ["env", "-u", "ELECTRON_RUN_AS_NODE", str(DESKTOP_DEV_EXECUTABLE), str(DESKTOP_CLIENT), "--show-window"], {
                    **DESKTOP_DEV_RUNTIME_ENV,
                    "OPENLEASH_CLIENT_MODE": "cloud",
                    "OPENLEASH_CLOUD_API_URL": cloud_desktop_api_url,
                    "OPENLEASH_CLOUD_DASHBOARD_URL": "http://localhost:9302",
                    "OPENLEASH_MOBILE_DEV_AUTH": cloud_mobile_dev_auth,
                    "OPENLEASH_PLUGIN_RUNTIME_SECRET": DEV_PLUGIN_RUNTIME_SECRET,
                    "OPENLEASH_PLUGIN_GATEWAY_IMAGE": "openleash/plugin-gateway:dev",
                    "OPENLEASH_DEV_PLUGIN_IMAGES": "1",
                }, DESKTOP_CLIENT),
            ],
            urls=[
                ("Main web", "http://localhost:9305"),
                ("Cloud dashboard", "http://localhost:9302"),
                ("Cloud ops", "http://localhost:9302/ops"),
                ("Identity Loader", "http://localhost:9321/api/sync/health"),
                ("Cloud client API", "http://localhost:9318/cloud/health"),
                ("Cloud dashboard API", "http://localhost:9319/cloud/admin/health"),
            ],
            ready_urls=[
                ("Identity Loader", "http://localhost:9321/api/sync/health"),
                ("Cloud client API", "http://localhost:9318/cloud/health"),
                ("Cloud dashboard API", "http://localhost:9319/cloud/admin/health"),
                ("Cloud dashboard", "http://localhost:9302"),
                ("Main web", "http://localhost:9305"),
            ],
        ),
        "private-cloud-full": Mode(
            key="private-cloud-full",
            label="Private Cloud Full Stack",
            description="Full local private-cloud simulation: main web, private APIs, dashboard web, identity loader, and desktop client.",
            needs_db=True,
            before=[
                Command("seed-org", [
                    "npm", "run", "db:create-org", "--",
                    "--name", "OpenLeash Private Cloud Dev",
                    "--slug", "self-hosted",
                    "--mode", "private",
                    "--setup-completed", "false",
                    "--current-step", "1",
                ], private_common),
                Command("desktop-build", ["npm", "run", "build", "-w", "@openleash/desktop-client"])
            ],
            processes=[
                Command("identity-loader", ["dotnet", "run", "--no-launch-profile"], identity_loader_env, ROOT / "IdentityLoader" / "IdentityLoader"),
                Command("client-api", ["npx", "tsx", "src/server.ts"], {
                    **private_common,
                    "OPENLEASH_API_PORT": "9318",
                    "OPENLEASH_API_SURFACE": "client",
                }, ROOT / "apps" / "client-api"),
                Command("dashboard-api", ["npx", "tsx", "src/server.ts"], {
                    **private_common,
                    "OPENLEASH_API_PORT": "9319",
                    "OPENLEASH_API_SURFACE": "dashboard",
                }, ROOT / "apps" / "client-api"),
                Command("dashboard-web", ["npm", "run", "dev:dashboard-web"], {
                    **private_common,
                    "OPENLEASH_DASHBOARD_PORT": "9301",
                    "OPENLEASH_API_URL": "http://localhost:9319",
                    "NEXT_PUBLIC_OPENLEASH_API_URL": "http://localhost:9319",
                }),
                Command("main-web", ["npm", "run", "dev:main-web"], private_main_web_env),
                Command("desktop-client", ["env", "-u", "ELECTRON_RUN_AS_NODE", str(DESKTOP_DEV_EXECUTABLE), str(DESKTOP_CLIENT), "--show-window"], {
                    **DESKTOP_DEV_RUNTIME_ENV,
                    "OPENLEASH_CLIENT_MODE": "self-hosted",
                    "OPENLEASH_CLOUD_API_URL": private_desktop_api_url,
                    "OPENLEASH_CLOUD_DASHBOARD_URL": "http://localhost:9301",
                    "OPENLEASH_PLUGIN_RUNTIME_SECRET": DEV_PLUGIN_RUNTIME_SECRET,
                    "OPENLEASH_PLUGIN_GATEWAY_IMAGE": "openleash/plugin-gateway:dev",
                    "OPENLEASH_DEV_PLUGIN_IMAGES": "1",
                }, DESKTOP_CLIENT),
            ],
            urls=[
                ("Main web", "http://localhost:9305"),
                ("Private dashboard", "http://localhost:9301/self-hosted"),
                ("Identity Loader", "http://localhost:9321/api/sync/health"),
                ("Client API", "http://localhost:9318/health"),
                ("Dashboard API", "http://localhost:9319/health"),
            ],
            ready_urls=[
                ("Identity Loader", "http://localhost:9321/api/sync/health"),
                ("Client API", "http://localhost:9318/health"),
                ("Dashboard API", "http://localhost:9319/health"),
                ("Private dashboard", "http://localhost:9301/self-hosted"),
                ("Main web", "http://localhost:9305"),
            ],
        ),
        "public-cloud": Mode(
            key="public-cloud",
            label="OpenLeash Cloud",
            description="Local simulation of the public hosted cloud: cloud APIs, cloud dashboard web, desktop client.",
            needs_db=True,
            before=[
                Command("client-api-build", ["npm", "run", "build", "-w", "@openleash/client-api"]),
                Command("seed-org", [
                    "npm", "run", "db:create-org", "--",
                    "--name", "OpenLeash Cloud Dev",
                    "--slug", "openleash-cloud",
                    "--mode", "cloud",
                    "--setup-completed", "false",
                    "--current-step", "1",
                ], cloud_common),
                Command("desktop-build", ["npm", "run", "build", "-w", "@openleash/desktop-client"])
            ],
            processes=[
                Command("identity-loader", ["dotnet", "run", "--no-launch-profile"], identity_loader_env, ROOT / "IdentityLoader" / "IdentityLoader"),
                Command("cloud-client-api", ["npx", "tsx", "src/server.ts"], {
                    **cloud_common,
                    "OPENLEASH_API_PORT": "9318",
                    "OPENLEASH_CLOUD_CLIENT_API_PORT": "9318",
                    "OPENLEASH_API_SURFACE": "client",
                }, ROOT / "apps" / "cloud-client-api"),
                Command("cloud-dashboard-api", ["npx", "tsx", "src/server.ts"], {
                    **cloud_common,
                    "OPENLEASH_API_PORT": "9319",
                    "OPENLEASH_CLOUD_DASHBOARD_API_PORT": "9319",
                    "OPENLEASH_API_SURFACE": "dashboard",
                    "OPENLEASH_PUBLIC_API_URL": "http://localhost:9319",
                }, ROOT / "apps" / "cloud-dashboard-api"),
                Command("cloud-dashboard-web", ["npm", "--prefix", "apps/cloud-dashboard-web", "run", "dev"], {
                    **cloud_common,
                    "OPENLEASH_CLOUD_DASHBOARD_PORT": "9302",
                    "OPENLEASH_DASHBOARD_URL": "http://localhost:9302",
                    "NEXT_PUBLIC_DASHBOARD_URL": "http://localhost:9302",
                    "OPENLEASH_API_URL": "http://localhost:9319",
                    "NEXT_PUBLIC_OPENLEASH_API_URL": "http://localhost:9319",
                    "NEXT_PUBLIC_OPENLEASH_CLOUD_DASHBOARD_API_URL": "http://localhost:9319",
                }),
                Command("desktop-client", ["env", "-u", "ELECTRON_RUN_AS_NODE", str(DESKTOP_DEV_EXECUTABLE), str(DESKTOP_CLIENT), "--show-window"], {
                    **DESKTOP_DEV_RUNTIME_ENV,
                    "OPENLEASH_CLIENT_MODE": "cloud",
                    "OPENLEASH_CLOUD_API_URL": cloud_desktop_api_url,
                    "OPENLEASH_CLOUD_DASHBOARD_URL": "http://localhost:9302",
                    "OPENLEASH_MOBILE_DEV_AUTH": cloud_mobile_dev_auth,
                }, DESKTOP_CLIENT),
            ],
            urls=[
                ("Cloud dashboard", "http://localhost:9302"),
                ("Cloud ops", "http://localhost:9302/ops"),
                ("Identity Loader", "http://localhost:9321/api/sync/health"),
                ("Cloud client API", "http://localhost:9318/cloud/health"),
                ("Cloud dashboard API", "http://localhost:9319/cloud/admin/health"),
            ],
            ready_urls=[
                ("Identity Loader", "http://localhost:9321/api/sync/health"),
                ("Cloud client API", "http://localhost:9318/cloud/health"),
                ("Cloud dashboard API", "http://localhost:9319/cloud/admin/health"),
                ("Cloud dashboard", "http://localhost:9302"),
            ],
        ),
        "private-cloud": Mode(
            key="private-cloud",
            label="Private Cloud",
            description="Single-tenant customer/private-cloud stack: core APIs, dashboard web, desktop client.",
            needs_db=True,
            before=[
                Command("seed-org", [
                    "npm", "run", "db:create-org", "--",
                    "--name", "OpenLeash Private Cloud Dev",
                    "--slug", "self-hosted",
                    "--mode", "private",
                    "--setup-completed", "false",
                    "--current-step", "1",
                ], private_common),
                Command("desktop-build", ["npm", "run", "build", "-w", "@openleash/desktop-client"])
            ],
            processes=[
                Command("identity-loader", ["dotnet", "run", "--no-launch-profile"], identity_loader_env, ROOT / "IdentityLoader" / "IdentityLoader"),
                Command("client-api", ["npx", "tsx", "src/server.ts"], {
                    **private_common,
                    "OPENLEASH_API_PORT": "9318",
                    "OPENLEASH_API_SURFACE": "client",
                }, ROOT / "apps" / "client-api"),
                Command("dashboard-api", ["npx", "tsx", "src/server.ts"], {
                    **private_common,
                    "OPENLEASH_API_PORT": "9319",
                    "OPENLEASH_API_SURFACE": "dashboard",
                }, ROOT / "apps" / "client-api"),
                Command("dashboard-web", ["npm", "run", "dev:dashboard-web"], {
                    **private_common,
                    "OPENLEASH_DASHBOARD_PORT": "9301",
                    "OPENLEASH_API_URL": "http://localhost:9319",
                    "NEXT_PUBLIC_OPENLEASH_API_URL": "http://localhost:9319",
                }),
                Command("desktop-client", ["env", "-u", "ELECTRON_RUN_AS_NODE", str(DESKTOP_DEV_EXECUTABLE), str(DESKTOP_CLIENT), "--show-window"], {
                    **DESKTOP_DEV_RUNTIME_ENV,
                    "OPENLEASH_CLIENT_MODE": "self-hosted",
                    "OPENLEASH_CLOUD_API_URL": private_desktop_api_url,
                    "OPENLEASH_CLOUD_DASHBOARD_URL": "http://localhost:9301",
                }, DESKTOP_CLIENT),
            ],
            urls=[
                ("Private dashboard", "http://localhost:9301/self-hosted"),
                ("Identity Loader", "http://localhost:9321/api/sync/health"),
                ("Client API", "http://localhost:9318/health"),
                ("Dashboard API", "http://localhost:9319/health"),
            ],
            ready_urls=[
                ("Identity Loader", "http://localhost:9321/api/sync/health"),
                ("Client API", "http://localhost:9318/health"),
                ("Dashboard API", "http://localhost:9319/health"),
                ("Private dashboard", "http://localhost:9301/self-hosted"),
            ],
        ),
    }


def should_clean_slate(args: argparse.Namespace) -> bool:
    if getattr(args, "keep_local", False):
        return False
    if getattr(args, "reset_data", False) or getattr(args, "reset_all", False):
        return False
    return True


def should_auto_load_plugins(mode_key: str | None) -> bool:
    return mode_key not in {"desktop-public", "desktop-custom"}


def canonical_mode_key(mode_key: str | None) -> str | None:
    if mode_key is None:
        return None
    return USER_MODE_ALIASES.get(mode_key, mode_key)


def cli_choice(args: argparse.Namespace, modes: dict[str, Mode]) -> RunChoice:
    clean_slate = should_clean_slate(args)
    reset = "clean-slate" if clean_slate else "all" if args.reset_all else "data" if args.reset_data else "none"
    mode_key = canonical_mode_key(args.mode)
    mode = modes[mode_key]
    if args.mode in USER_MODE_LABELS:
        mode = replace(mode, label=USER_MODE_LABELS[args.mode], description=USER_MODE_DETAILS[args.mode])
    load_plugins = args.load_plugins or should_auto_load_plugins(args.mode)
    return RunChoice(mode=mode, reset=reset, clean_slate=clean_slate, load_plugins=load_plugins, plugins_dir=Path(args.plugins_dir), desktop_api_url=args.desktop_api_url, dev_auth=args.dev_auth)


def choose_run_questionnaire() -> QuestionnaireChoice:
    print("OpenLeash runner")
    print("Product contract: desktop-client requires Individual Open Source, OpenLeash Cloud, or Private Cloud backend. Dev modes use Postgres, migrations, seeded account/org data, APIs, and desktop.")
    print("Answer the questions below. Type q anytime to cancel.\n")

    mode_options = [
        (USER_MODE_LABELS["individual-open-source"], USER_MODE_DETAILS["individual-open-source"], "individual-open-source"),
        (USER_MODE_LABELS["individual-cloud-byok"], USER_MODE_DETAILS["individual-cloud-byok"], "individual-cloud-byok"),
        (USER_MODE_LABELS["individual-cloud-managed"], USER_MODE_DETAILS["individual-cloud-managed"], "individual-cloud-managed"),
        (USER_MODE_LABELS["org-private-cloud"], USER_MODE_DETAILS["org-private-cloud"], "org-private-cloud"),
        (USER_MODE_LABELS["org-cloud-byok"], USER_MODE_DETAILS["org-cloud-byok"], "org-cloud-byok"),
        (USER_MODE_LABELS["org-cloud-managed"], USER_MODE_DETAILS["org-cloud-managed"], "org-cloud-managed"),
        (USER_MODE_LABELS["public-cloud-full"], USER_MODE_DETAILS["public-cloud-full"], "public-cloud-full"),
        (USER_MODE_LABELS["private-cloud-full"], USER_MODE_DETAILS["private-cloud-full"], "private-cloud-full"),
        (USER_MODE_LABELS["desktop-public"], USER_MODE_DETAILS["desktop-public"], "desktop-public"),
        (USER_MODE_LABELS["desktop-custom"], USER_MODE_DETAILS["desktop-custom"], "desktop-custom"),
    ]
    _mode_label, _mode_detail, mode_key = choose_run_mode_or_alias(mode_options)
    if isinstance(mode_key, dict) and mode_key.get("alias_config"):
        alias_config = normalize_alias_config(mode_key["alias_config"])
        print_questionnaire_summary(
            alias_config.mode_key or "",
            alias_config.reset,
            alias_config.dev_auth,
            alias_config.load_plugins,
            alias_config.plugins_dir,
            alias_config.desktop_api_url,
        )
        if not confirm("Start this run?", default=True):
            cancel()
        if alias_config.mode_key in {"desktop-public", "desktop-custom"}:
            replay_args = argparse.Namespace(
                mode=alias_config.mode_key,
                desktop_api_url=alias_config.desktop_api_url,
                dev_auth=alias_config.dev_auth,
                clean_slate=alias_config.clean_slate,
                keep_local=not alias_config.clean_slate,
            )
            raise SystemExit(run_desktop_only(replay_args))
        return alias_config

    if mode_key == "__clean__":
        print("\nThis permanently deletes the local OpenLeash Postgres database and all local OpenLeash client state.")
        if not confirm("Clean everything local to OpenLeash?", default=False):
            cancel()
        return QuestionnaireChoice(mode_key=None, reset="none", cleanup_only=True)

    clean_slate = confirm("Start from a fully clean local OpenLeash environment?", default=True)

    if mode_key in {"desktop-public", "desktop-custom"}:
        reset = "clean-slate" if clean_slate else "none"
    else:
        if clean_slate:
            reset = "clean-slate"
        else:
            reset_options = [
                ("Keep DB data", "run migrations and keep existing dev tenants/runtime data", "none"),
                ("Reset tenant/runtime data", "clear dev tenant/runtime data but keep policies", "data"),
                ("Reset all DB data", "clear all dev DB data, including policies", "all"),
            ]
            _reset_label, _reset_detail, reset = choose_option("How should the dev database start?", reset_options, default=1)

    dev_auth = False
    if mode_key == "individual-open-source":
        print("Auth: Individual Open Source uses local bootstrap; no OpenLeash Cloud sign-in is required.")
    else:
        auth_options = [
            ("Real OAuth", "normal path; use configured Google/Microsoft/GitHub OAuth credentials", False),
            ("Local dev auth", "shortcut for UI work only; skips real managed sign-in", True),
        ]
        _auth_label, _auth_detail, dev_auth = choose_option("Which auth path should managed sign-in use?", auth_options, default=1)
    if mode_key != "individual-open-source" and not dev_auth and not cloud_oauth_configured():
        print("\n[openleash] Real OAuth was selected, but Google/Microsoft OAuth credentials were not found in env/.env.")
        print("[openleash] Expected either OPENLEASH_GOOGLE_CLIENT_ID/SECRET or OPENLEASH_MICROSOFT_CLIENT_ID/SECRET.")
        if not confirm("Continue anyway?", default=False):
            cancel()

    load_plugins = should_auto_load_plugins(mode_key)
    plugins_dir = DEFAULT_PLUGINS_DIR

    desktop_api_url = None
    if mode_key == "desktop-public":
        desktop_api_url = "https://api.openleash.com"
    elif mode_key == "desktop-custom":
        desktop_api_url = prompt_input("Desktop API URL: ").strip()
        if desktop_api_url.lower() in {"q", "quit", "exit"}:
            cancel()
        if not desktop_api_url:
            cancel()
    print_questionnaire_summary(mode_key, reset, dev_auth, load_plugins, plugins_dir, desktop_api_url)
    if not confirm("Start this run?", default=True):
        cancel()

    if mode_key in {"desktop-public", "desktop-custom"}:
        replay_args = argparse.Namespace(
            mode=mode_key,
            desktop_api_url=desktop_api_url,
            dev_auth=dev_auth,
            clean_slate=clean_slate,
            keep_local=not clean_slate,
        )
        raise SystemExit(run_desktop_only(replay_args))

    return QuestionnaireChoice(
        mode_key=canonical_mode_key(mode_key),
        reset=reset,
        requested_mode_key=mode_key,
        clean_slate=clean_slate,
        dev_auth=dev_auth,
        load_plugins=load_plugins,
        plugins_dir=plugins_dir,
        desktop_api_url=desktop_api_url,
    )


def choose_run_mode_or_alias(mode_options: list[tuple[str, str, object]]) -> tuple[str, str, object]:
    aliases = load_run_aliases()
    print("What do you want to run?")
    numbered: list[tuple[str, str, object]] = []
    for label, detail, value in mode_options:
        numbered.append((label, detail, value))
        print(f"  {len(numbered)}. {label} - {detail}{' [default]' if len(numbered) == 1 else ''}")
    if aliases:
        print("  -------------------------------- saved run aliases")
        for alias in aliases:
            config = alias.get("config") if isinstance(alias, dict) else None
            name = str(alias.get("name") or "").strip() if isinstance(alias, dict) else ""
            if not name or not isinstance(config, dict):
                continue
            detail = alias_summary(config)
            numbered.append((name, detail, {"alias_config": config}))
            print(f"  {len(numbered)}. {name} - {detail}")
    print("  -------------------------------- destructive action")
    print("  c. Clean everything - remove all local OpenLeash services, client state/app, hooks, proxy, containers, and Postgres data")

    while True:
        raw = prompt_input("Choose [default 1]: ").strip()
        if not raw:
            raw = "1"
        if raw.lower() in {"q", "quit", "exit"}:
            cancel()
        if raw.lower() in {"c", "clean"}:
            return ("Clean everything", "delete all local OpenLeash runtime state", "__clean__")
        if raw.isdigit():
            selected = int(raw)
            if 1 <= selected <= len(numbered):
                return numbered[selected - 1]
        print(f"Please choose a number from 1 to {len(numbered)}.")


def load_run_aliases() -> list[dict[str, object]]:
    aliases_by_name: dict[str, dict[str, object]] = {}
    for alias in DEFAULT_RUN_ALIASES:
        name = str(alias.get("name") or "").strip()
        if name:
            aliases_by_name[name] = alias
    for aliases_path in (RUN_ALIASES_LEGACY_PATH, RUN_ALIASES_PATH):
        if not aliases_path.exists():
            continue
        try:
            payload = json.loads(aliases_path.read_text())
            saved_aliases = payload.get("aliases") if isinstance(payload, dict) else payload
            if isinstance(saved_aliases, list):
                for alias in saved_aliases:
                    if not isinstance(alias, dict):
                        continue
                    name = str(alias.get("name") or "").strip()
                    config = alias.get("config")
                    if name and isinstance(config, dict):
                        aliases_by_name[name] = {"name": name, "config": config}
        except (OSError, json.JSONDecodeError) as error:
            print(f"[openleash] warning: could not read run aliases from {aliases_path}: {error}")
    return list(aliases_by_name.values())


def save_run_alias(name: str, config: dict[str, object]) -> None:
    name = name.strip()
    if not name:
        return
    aliases = [alias for alias in load_run_aliases() if alias.get("name") != name]
    aliases.append({"name": name, "config": config})
    RUN_ALIASES_PATH.parent.mkdir(parents=True, exist_ok=True)
    RUN_ALIASES_PATH.write_text(json.dumps({"version": 1, "aliases": aliases}, indent=2, sort_keys=True) + "\n")


def normalize_alias_config(config: dict[str, object]) -> QuestionnaireChoice:
    mode_key = config.get("mode_key")
    raw_plugins_dir = config.get("plugins_dir") or str(DEFAULT_PLUGINS_DIR)
    reset = str(config.get("reset") or "none")
    clean_slate = bool(config.get("clean_slate")) or reset == "clean-slate"
    return QuestionnaireChoice(
        mode_key=str(mode_key) if mode_key is not None else None,
        reset="clean-slate" if clean_slate else reset,
        requested_mode_key=str(mode_key) if mode_key is not None else None,
        clean_slate=clean_slate,
        dev_auth=bool(config.get("dev_auth")),
        load_plugins=bool(config.get("load_plugins")),
        plugins_dir=Path(str(raw_plugins_dir)).expanduser(),
        desktop_api_url=str(config.get("desktop_api_url")) if config.get("desktop_api_url") else None,
    )


def alias_summary(config: dict[str, object]) -> str:
    mode_key = str(config.get("mode_key") or "")
    pieces = [
        USER_MODE_LABELS.get(mode_key, mode_key or "unknown mode"),
        str(config.get("reset") or "none"),
    ]
    pieces.append("local bootstrap" if mode_key == "individual-open-source" else "dev auth" if config.get("dev_auth") else "real OAuth")
    if config.get("load_plugins"):
        pieces.append("load plugins")
    desktop_api_url = config.get("desktop_api_url")
    pieces.append(str(desktop_api_url) if desktop_api_url else "local dev API")
    return ", ".join(pieces)


def choose_option(question: str, options: list[tuple[str, str, object]], default: int = 1) -> tuple[str, str, object]:
    print(question)
    for offset, (label, detail, _value) in enumerate(options):
        displayed = offset + 1
        suffix = " [default]" if displayed == default else ""
        print(f"  {displayed}. {label} - {detail}{suffix}")
    while True:
        raw = prompt_input(f"Choose [default {default}]: ").strip()
        if not raw:
            raw = str(default)
        if raw.lower() in {"q", "quit", "exit"}:
            cancel()
        if raw.isdigit():
            selected = int(raw)
            if 1 <= selected <= len(options):
                return options[selected - 1]
        print(f"Please choose a number from 1 to {len(options)}.")


def confirm(question: str, default: bool = True) -> bool:
    suffix = "Y/n" if default else "y/N"
    while True:
        raw = prompt_input(f"{question} [{suffix}] ").strip().lower()
        if raw in {"q", "quit", "exit"}:
            cancel()
        if not raw:
            return default
        if raw in {"y", "yes"}:
            return True
        if raw in {"n", "no"}:
            return False
        print("Please answer y or n.")


def print_questionnaire_summary(mode_key: str, reset: str, dev_auth: bool, load_plugins: bool, plugins_dir: Path, desktop_api_url: str | None = None) -> None:
    print("\nRun summary:")
    print(f"  - Mode: {USER_MODE_LABELS.get(mode_key, mode_key)}")
    print(f"  - Reset: {reset}")
    print(f"  - Auth: {'local bootstrap' if mode_key == 'individual-open-source' else 'local dev auth' if dev_auth else 'real OAuth'}")
    print(f"  - Load plugins: {'yes' if load_plugins else 'no'}")
    if load_plugins:
        print(f"  - Plugins dir: {plugins_dir}")
    print(f"  - Desktop API: {desktop_api_url or 'local dev API'}")


def cancel() -> None:
    print("Cancelled.")
    raise SystemExit(130)


def prompt_input(prompt: str) -> str:
    try:
        return input(prompt)
    except EOFError:
        cancel()


def print_header(mode: Mode, reset: str, dev_auth: bool, load_plugins: bool = False, plugins_dir: Path = DEFAULT_PLUGINS_DIR, desktop_api_url: str | None = None) -> None:
    print(f"\nMode: {mode.label}")
    print(f"Description: {mode.description}")
    print(f"Database: {'required' if mode.needs_db else 'not used'}")
    print(f"Reset: {reset}")
    print(f"Desktop API: {desktop_api_url or 'local dev API'}")
    print_replay_command(mode, reset, dev_auth, load_plugins=load_plugins, plugins_dir=plugins_dir, desktop_api_url=desktop_api_url)


def print_plugin_load_header(plugins_dir: Path) -> None:
    print("\nMode: Load plugins into database")
    print("This starts local Postgres if needed, runs migrations, and upserts plugin catalog rows from the plugins folder.")
    print(f"Plugins dir: {plugins_dir}")
    args = ["python3", "run.py", "--load-plugins", "--plugins-dir", str(plugins_dir), "--yes"]
    print(f"Command: {format_command(args)}")


def print_replay_command(
    mode: Mode | None,
    reset: str,
    dev_auth: bool,
    cleanup_only: bool = False,
    load_plugins: bool = False,
    plugins_dir: Path = DEFAULT_PLUGINS_DIR,
    desktop_api_url: str | None = None,
) -> None:
    args = ["python3", "run.py"]
    if cleanup_only:
        args.append("--clean")
        print(f"Command: {format_command(args)}")
        return

    if mode:
        display_mode_key = next((key for key, label in USER_MODE_LABELS.items() if label == mode.label and key in USER_MODE_ALIASES), mode.key)
        args.extend(["--mode", display_mode_key])
    if reset == "data":
        args.append("--reset-data")
    elif reset == "all":
        args.append("--reset-all")
    elif reset == "clean-slate":
        args.append("--clean-slate")
    elif reset == "none":
        args.append("--keep-local")
    if dev_auth:
        args.append("--dev-auth")
    if desktop_api_url:
        args.extend(["--desktop-api-url", desktop_api_url])
    if load_plugins:
        args.append("--load-plugins")
        if plugins_dir != DEFAULT_PLUGINS_DIR:
            args.extend(["--plugins-dir", str(plugins_dir)])
    args.append("--yes")
    print(f"Command: {format_command(args)}")


def load_plugins_from_folder(plugins_dir: Path) -> None:
    run_step(Command("load-plugins", [
        "npm", "run", "db:load-plugins", "-w", "@openleash/client-api", "--",
        "--dir", str(plugins_dir.resolve()),
    ], {"DATABASE_URL": DATABASE_URL}))


def core_migrate_command() -> Command:
    return Command(
        "migrate-core",
        ["python3", "migrate.py", "--target", "local", "--scope", "core", "--apply", "--yes"],
        {"COMPOSE_PROJECT_NAME": "openleash-dev"},
        cwd=ROOT,
    )


def cloud_migrate_command() -> Command:
    return Command(
        "migrate-cloud",
        ["python3", "migrate.py", "--target", "local", "--scope", "cloud", "--apply", "--yes"],
        {"COMPOSE_PROJECT_NAME": "openleash-dev"},
        cwd=ROOT,
    )


def local_migration_commands_for_mode(mode: Mode) -> list[Command]:
    commands = [core_migrate_command()]
    if mode.key in {"public-cloud", "public-cloud-full", "individual-open-source"}:
        commands.append(cloud_migrate_command())
    return commands


def print_urls(mode: Mode) -> None:
    if not mode.urls:
        return
    print("\nOpenLeash URLs:")
    for label, url in mode.urls:
        print(f"  - {label}: {url}")
    if mode.key in {"public-cloud", "public-cloud-full"}:
        print("  - Cloud ops bootstrap token: local-cloud-bootstrap")
    if mode.key in {"private-cloud", "private-cloud-full"}:
        print("  - First-owner bootstrap value: local-private-bootstrap")
    print()


def wait_for_ready_urls(urls: list[tuple[str, str]], children: list[subprocess.Popen[str]], timeout_seconds: int = 150) -> None:
    pending = dict(urls)
    deadline = time.time() + timeout_seconds
    print("[openleash] waiting for services to be ready before launching desktop...")
    while pending and time.time() < deadline:
        failed_child = first_exited_child(children)
        if failed_child is not None:
            raise RuntimeError(f"{short_command(format_child_args(failed_child))} exited with {failed_child.returncode} before the stack was ready")

        for label, url in list(pending.items()):
            if http_ready(url):
                print(f"[openleash:ready] {label}: {url}")
                pending.pop(label, None)
        if pending:
            time.sleep(0.75)

    if pending:
        waiting_on = ", ".join(f"{label} ({url})" for label, url in pending.items())
        raise TimeoutError(f"timed out waiting for {waiting_on}. {readiness_debug_hint(children)}")


def wait_for_desktop_ready(child: subprocess.Popen[str], timeout_seconds: int = 30) -> None:
    url = "http://127.0.0.1:9317/health"
    deadline = time.time() + timeout_seconds
    print("[openleash] waiting for desktop client to initialize...")
    while time.time() < deadline:
        code = child.poll()
        if code is not None:
            raise RuntimeError(f"desktop client exited with {code} during startup")
        if http_ready(url):
            print(f"[openleash:ready] Desktop client: {url}")
            return
        time.sleep(0.25)
    raise RuntimeError(
        "desktop client stayed alive but its local API did not become ready; "
        "check the desktop startup log for the initialization error"
    )


def first_exited_child(children: list[subprocess.Popen[str]]) -> subprocess.Popen[str] | None:
    for child in children:
        if child.poll() is not None:
            return child
    return None


def http_ready(url: str) -> bool:
    try:
        request = urllib.request.Request(url, headers={"accept": "application/json,text/html;q=0.9,*/*;q=0.8"})
        with urllib.request.urlopen(request, timeout=1.5) as response:
            return 200 <= response.status < 500
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def readiness_debug_hint(children: list[subprocess.Popen[str]]) -> str:
    states = []
    for child in children:
        code = child.poll()
        state = "running" if code is None else f"exited {code}"
        states.append(f"{short_command(format_child_args(child))}: {state}")
    listeners = port_listener_summary([9318, 9319, 9320, 9321, 9301, 9302])
    return f"Processes: {'; '.join(states) or 'none'}. Listeners: {listeners or 'none'}."


def port_listener_summary(ports: list[int]) -> str:
    rows = []
    for port in ports:
        try:
            output = subprocess.check_output(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"], text=True, stderr=subprocess.DEVNULL)
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
        lines = [line for line in output.splitlines()[1:] if line.strip()]
        if lines:
            rows.append(f"{port}: {len(lines)} listener")
    return ", ".join(rows)


def format_child_args(child: subprocess.Popen[str]) -> str:
    args = child.args
    if isinstance(args, list):
        return format_command([str(part) for part in args])
    return str(args)


def run_step(command: Command) -> None:
    print(f"[openleash:{command.name}] {format_command_with_env(command)}")
    attempts = 5 if command.name.startswith("migrate") else 1
    last_error: subprocess.CalledProcessError | None = None
    for attempt in range(1, attempts + 1):
        try:
            subprocess.run(command.args, cwd=command.cwd, env=merged_env(command.env), check=True)
            return
        except subprocess.CalledProcessError as error:
            last_error = error
            if attempt >= attempts:
                break
            wait_seconds = min(2 * attempt, 8)
            print(f"[openleash:{command.name}] failed, retrying in {wait_seconds}s ({attempt}/{attempts})...")
            time.sleep(wait_seconds)
    if last_error:
        raise last_error


def prepare_event_plugin_containers() -> None:
    """Build and start the isolated first-party event workers used by local dev modes."""
    run_step(Command("plugin-shared-build", ["npm", "run", "build", "-w", "@openleash/shared"]))
    run_step(Command("plugin-gateway-image", [
        "docker", "build", "-f", "plugins/container-runtime/Dockerfile.gateway",
        "-t", "openleash/plugin-gateway:dev", ".",
    ]))
    for plugin_id, slug, version, port in EVENT_PLUGIN_SPECS:
        image = f"openleash/plugin-{slug}:dev"
        name = f"openleash-dev-plugin-{slug}"
        run_step(Command(f"plugin-{slug}-build", ["npm", "run", "build", "--prefix", f"plugins/plugin-{slug}"]))
        run_step(Command(f"plugin-{slug}-image", [
            "docker", "build", "-f", f"plugins/plugin-{slug}/Dockerfile", "-t", image, ".",
        ]))
        run_optional_step(Command(f"plugin-{slug}-replace", ["docker", "rm", "-f", name]))
        run_step(Command(f"plugin-{slug}-start", [
            "docker", "run", "-d",
            "--name", name,
            "--label", "com.openleash.dev-event-plugin=true",
            "--restart", "unless-stopped",
            "--read-only",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges:true",
            "--pids-limit", "128",
            "--memory", "256m",
            "--cpu-shares", "256",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m,mode=1777",
            "-p", f"127.0.0.1:{port}:8080",
            "-e", f"OPENLEASH_PLUGIN_ID={plugin_id}",
            "-e", f"OPENLEASH_PLUGIN_RUNTIME_SECRET={DEV_PLUGIN_RUNTIME_SECRET}",
            image,
        ]))


def cleanup_local_openleash() -> None:
    print("\nMode: Delete local OpenLeash")
    print("This stops every local OpenLeash service, restores agent proxy configuration, removes OpenLeash containers and Postgres volumes, and deletes client state, settings, hooks, logs, and installed app copies.")

    individual_runtime_dir = Path.home() / ".openleash" / "individual-open-source"
    steps = [
        Command("uninstall-local-proxy", ["npm", "run", "desktop-cli", "--", "proxy", "uninstall"]),
        Command("remove-local-proxy-container", ["docker", "rm", "-f", "openleash-local-proxy"]),
        Command("uninstall-hooks", ["npm", "run", "desktop-cli", "--", "uninstall-hooks", "--all"]),
        Command("stop-desktop-app", ["pkill", "-TERM", "-f", "/OpenLeash.app/"]),
        Command("stop-dev-electron", ["pkill", "-TERM", "-f", "electron dist/main.js"]),
        Command("stop-flow-viewer", ["pkill", "-TERM", "-f", "apps/flow-viewer/server.mjs"]),
        Command("stop-compose-and-remove-db", [*DEV_COMPOSE, "down", "-v", "--remove-orphans"]),
        # Older runs used Compose's default repository project name. Stop that
        # project too so its explicitly named Postgres volume is not still in
        # use when a clean-slate run removes it.
        Command("stop-legacy-compose-and-remove-db", ["docker", "compose", "--project-name", "ol2", "down", "-v", "--remove-orphans"]),
        Command("stop-individual-open-source-compose", ["docker", "compose", "down", "-v", "--remove-orphans"], cwd=individual_runtime_dir),
        Command("remove-openleash-containers", [
            "docker", "rm", "-f",
            "openleash-postgres",
            "openleash-client-api",
            "openleash-dashboard-api",
            "openleash-local-proxy",
            "openleash-individual-postgres",
            "openleash-individual-client-api",
        ]),
        Command("remove-local-proxy-dev-image", ["docker", "image", "rm", "openleash-local-proxy:dev"]),
    ]
    for step in steps:
        run_optional_step(step)
    for volume_name in [
        "ol2_openleash-postgres",
        "openleash_openleash-postgres",
        "openleash-individual_openleash-individual-postgres",
        "openleash-private-cloud_openleash-postgres",
    ]:
        remove_docker_volume_if_present(volume_name)

    cleanup_ports = [4317, 9317, 9318, 9319, 9320, 9321, 9301, 9302, 9305, 9338, 9340]
    cleanup_ports.extend(spec[3] for spec in EVENT_PLUGIN_SPECS)
    for port in cleanup_ports:
        terminate_listeners_on_port(port)

    paths = [
        Path.home() / ".openleash",
        Path.home() / "Library" / "Application Support" / "OpenLeash",
        Path.home() / "Library" / "Logs" / "OpenLeash",
        Path.home() / "Library" / "Saved Application State" / "com.openleash.openleash.savedState",
        Path("/Applications/OpenLeash.app"),
        Path.home() / "Applications" / "OpenLeash.app",
        Path("/tmp/openleash-startup.log"),
    ]
    for target in paths:
        remove_path(target)

    print("[openleash] local cleanup complete.")


def run_optional_step(command: Command) -> None:
    print(f"[openleash:{command.name}] {format_command_with_env(command)}")
    try:
        subprocess.run(command.args, cwd=command.cwd, env=merged_env(command.env), check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        print(f"[openleash:{command.name}] skipped; command not found")


def remove_docker_volume_if_present(volume_name: str) -> None:
    """Remove an OpenLeash database volume or fail a requested clean slate.

    Docker Compose can leave an unnamed/orphaned container attached to a named
    volume. Silently ignoring that error makes a subsequent `--clean-slate`
    run reuse production-like state while claiming it started clean.
    """
    inspect = subprocess.run(
        ["docker", "volume", "inspect", volume_name],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if inspect.returncode != 0:
        return

    print(f"[openleash:remove-openleash-postgres-volume-{volume_name}] docker volume rm {volume_name}")
    attached = subprocess.run(
        ["docker", "ps", "-aq", "--filter", f"volume={volume_name}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    for container_id in attached:
        subprocess.run(["docker", "rm", "-f", container_id], check=False)

    removed = subprocess.run(
        ["docker", "volume", "rm", volume_name],
        capture_output=True,
        text=True,
        check=False,
    )
    if removed.returncode != 0:
        detail = (removed.stderr or removed.stdout).strip()
        raise RuntimeError(
            f"Cannot complete clean-slate: Docker volume {volume_name!r} is still in use. "
            f"{detail or 'Restart Docker Desktop and retry.'}"
        )


def stop_existing_dev_stack(mode: Mode) -> None:
    print(f"[openleash:stop-existing] clearing stale dev services before {mode.label}")
    run_optional_step(Command("stop-compose-containers", [*DEV_COMPOSE, "down", "--remove-orphans"]))
    individual_runtime_dir = Path.home() / ".openleash" / "individual-open-source"
    if (individual_runtime_dir / "docker-compose.yml").exists():
        run_optional_step(Command(
            "stop-installed-individual-runtime",
            ["docker", "compose", "down", "--remove-orphans"],
            cwd=individual_runtime_dir,
        ))
    # The desktop-managed proxy is not part of the root Compose project. Stop
    # its container before clearing port 9320; otherwise lsof reports Docker's
    # backend as the listener and terminating that PID shuts down Docker itself.
    run_optional_step(Command("stop-desktop-local-proxy", ["docker", "rm", "-f", "openleash-local-proxy"]))
    for _, slug, _, _ in EVENT_PLUGIN_SPECS:
        run_optional_step(Command(f"stop-dev-plugin-{slug}", ["docker", "rm", "-f", f"openleash-dev-plugin-{slug}"]))

    ports = [4317, 9317, 9318, 9319, 9320, 9321, 9301, 9302, 9338, 9340]
    if any(process.name == "main-web" for process in mode.processes):
        ports.append(9305)
    patterns = [
        str(DESKTOP_DEV_APP),
        "/OpenLeash.app/",
        "electron dist/main.js",
        "apps/cloud-client-api",
        "apps/cloud-dashboard-api",
        "apps/cloud-dashboard-web",
        "apps/main-web",
        "apps/client-api",
        "apps/flow-viewer/server.mjs",
        "apps/dashboard-web",
        "IdentityLoader/IdentityLoader",
        "next dev -p 9301",
        "next dev -p 9302",
        "next dev -p 9305",
    ]

    for pattern in patterns:
        terminate_matching_processes(pattern)

    for port in dict.fromkeys(ports):
        terminate_listeners_on_port(port)


def terminate_matching_processes(pattern: str) -> None:
    current_pid = os.getpid()
    for pid, command in process_table():
        if pid == current_pid or pattern not in command or "rg " in command:
            continue
        print(f"[openleash:stop-existing] pid {pid} {short_command(command)}")
        terminate_pid(pid)


def terminate_listeners_on_port(port: int) -> None:
    try:
        output = subprocess.check_output(["lsof", "-tiTCP:%d" % port, "-sTCP:LISTEN"], text=True, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return
    commands_by_pid = dict(process_table())
    for raw_pid in output.splitlines():
        if not raw_pid.strip().isdigit():
            continue
        pid = int(raw_pid.strip())
        if pid == os.getpid():
            continue
        command = commands_by_pid.get(pid, "")
        if is_container_runtime_process(command):
            print(f"[openleash:stop-port] {port} belongs to the container runtime; leaving pid {pid} running")
            continue
        print(f"[openleash:stop-port] {port} pid {pid}")
        terminate_pid(pid)


def is_container_runtime_process(command: str) -> bool:
    normalized = command.lower()
    return any(marker in normalized for marker in (
        "/docker.app/",
        "com.docker.backend",
        "docker-proxy",
        "vpnkit",
        "/orbstack",
        "io.orbstack",
        "/.colima/",
        "/lima/",
    ))


def terminate_pid(pid: int) -> None:
    try:
      os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
      return
    except PermissionError:
      return
    time.sleep(0.15)
    try:
      os.kill(pid, 0)
    except ProcessLookupError:
      return
    except PermissionError:
      return
    try:
      os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
      return


def process_table() -> list[tuple[int, str]]:
    try:
        output = subprocess.check_output(["ps", "-axo", "pid=,command="], text=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    rows: list[tuple[int, str]] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        pid_text, _, command = stripped.partition(" ")
        if pid_text.isdigit():
            rows.append((int(pid_text), command))
    return rows


def short_command(command: str) -> str:
    return command if len(command) <= 160 else f"{command[:157]}..."


def prepare_desktop_dev_app() -> None:
    rebuild_desktop_native_modules()
    run_step(
        Command(
            "desktop-package",
            [
                "npx",
                "electron-builder",
                "--config",
                "electron-builder.personal.yml",
                "--mac",
                "--arm64",
                "--dir",
            ],
        ),
    )
    verify_desktop_native_modules()
    source = ROOT / "release" / "personal" / "mac-arm64" / "OpenLeash.app"
    print(f"[openleash:desktop-dev-app] copy packaged app to {DESKTOP_DEV_APP}")
    if not source.exists():
        raise FileNotFoundError(f"Packaged OpenLeash app not found: {source}")
    if DESKTOP_DEV_APP.exists():
        shutil.rmtree(DESKTOP_DEV_APP)
    DESKTOP_DEV_APP.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, DESKTOP_DEV_APP, symlinks=True)


def rebuild_desktop_native_modules() -> None:
    electron_version = desktop_electron_version()
    run_step(
        Command(
            "desktop-native-rebuild",
            ["npx", "electron-rebuild", "-v", electron_version, "-w", "better-sqlite3", "-m", ".", "--force"],
        ),
    )


def verify_desktop_native_modules() -> None:
    run_step(
        Command(
            "desktop-package-verify",
            ["node", "scripts/verify-packaged-desktop.mjs"],
        ),
    )


def desktop_electron_version() -> str:
    package_path = DESKTOP_CLIENT / "package.json"
    try:
        package = json.loads(package_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"could not read Electron version from {package_path}: {error}") from error
    raw_version = str((package.get("dependencies") or {}).get("electron") or (package.get("devDependencies") or {}).get("electron") or "")
    version = raw_version.lstrip("^~>=< ")
    if not version:
        raise RuntimeError(f"Electron dependency is missing from {package_path}")
    return version


def remove_path(target: Path) -> None:
    print(f"[openleash:remove] {target}")
    try:
        if target.is_symlink() or target.is_file():
            target.unlink(missing_ok=True)
        elif target.exists():
            shutil.rmtree(target)
    except PermissionError:
        print(f"[openleash:remove] permission denied: {target}")


def start_process(command: Command) -> subprocess.Popen[str]:
    print(f"[openleash:{command.name}] {format_command_with_env(command)}")
    process = subprocess.Popen(
        command.args,
        cwd=command.cwd,
        env=merged_env(command.env),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    attach_output(command.name, process)
    return process


def flow_viewer_command() -> list[str]:
    return ["node", str(ROOT / "apps" / "flow-viewer" / "server.mjs")]


def run_flow_viewer() -> int:
    print(f"[openleash] Starting flow-viewer for: {PIPELINE_TRACE_FILE}")
    if http_ready("http://127.0.0.1:9340/healthz"):
        open_flow_viewer_browser()
        return 0
    try:
        child = subprocess.Popen(
            flow_viewer_command(),
            cwd=ROOT,
            env=merged_env({"OPENLEASH_PIPELINE_TRACE_FILE": str(PIPELINE_TRACE_FILE)}),
        )
        wait_for_ready_urls([("flow-viewer", "http://127.0.0.1:9340/healthz")], [child], 15)
        open_flow_viewer_browser()
        return child.wait()
    except FileNotFoundError:
        print("[openleash] Node.js is required to view the flow log.", file=sys.stderr)
        return 1


def open_flow_viewer_browser() -> None:
    url = "http://127.0.0.1:9340"
    try:
        if not webbrowser.open(url):
            raise RuntimeError("the operating system did not accept the browser request")
        print(f"[openleash] Opened flow-viewer: {url}")
    except (OSError, RuntimeError) as error:
        print(f"[openleash] Could not open the browser automatically: {error}")
        print(f"[openleash] Open it manually: {url}")


def format_command_with_env(command: Command) -> str:
    env_parts = [
        f"{key}={redact_database_url(value) if key == 'DATABASE_URL' else value}"
        for key, value in sorted(command.env.items())
    ]
    return format_command([*env_parts, *command.args])


def redact_database_url(value: str) -> str:
    try:
        from urllib.parse import urlsplit, urlunsplit

        parts = urlsplit(value)
        if not parts.password:
            return value
        username = parts.username or ""
        hostname = parts.hostname or ""
        port = f":{parts.port}" if parts.port else ""
        netloc = f"{username}:****@{hostname}{port}"
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    except Exception:
        return value


def attach_output(name: str, process: subprocess.Popen[str]) -> None:
    import threading

    def pump() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            print(f"[{name}] {line}", end="")

    threading.Thread(target=pump, daemon=True).start()


def merged_env(extra: dict[str, str]) -> dict[str, str]:
    env = os.environ.copy()
    for key, value in DOTENV.items():
        env.setdefault(key, value)
    env.update(extra)
    return env


def env_value(key: str) -> str:
    return os.environ.get(key) or DOTENV.get(key, "")


def cloud_oauth_configured() -> bool:
    google = bool((env_value("OPENLEASH_GOOGLE_CLIENT_ID") or env_value("GOOGLE_CLIENT_ID")) and (env_value("OPENLEASH_GOOGLE_CLIENT_SECRET") or env_value("GOOGLE_CLIENT_SECRET")))
    microsoft = bool((env_value("OPENLEASH_MICROSOFT_CLIENT_ID") or env_value("AZURE_CLIENT_ID")) and (env_value("OPENLEASH_MICROSOFT_CLIENT_SECRET") or env_value("AZURE_CLIENT_SECRET")))
    github = bool((env_value("OPENLEASH_GITHUB_CLIENT_ID") or env_value("OPENLEASH_GITHUB_DEV_CLIENT_ID")) and (env_value("OPENLEASH_GITHUB_CLIENT_SECRET") or env_value("OPENLEASH_GITHUB_DEV_CLIENT_SECRET")))
    return google or microsoft or github


def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key.startswith("#"):
            continue
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        values[key] = value
    return values


def format_command(args: Iterable[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in args)


if __name__ == "__main__":
    raise SystemExit(main())
