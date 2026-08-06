#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATABASE_URL = "postgres://openleash:openleash@127.0.0.1:9543/openleash"
TRACE_FILE = ROOT / "output" / "openleash-flow.ndjson"
COMPOSE = ["docker", "compose", "--project-name", "openleash-dev"]
PERSONAL_TOKEN = "individual-open-source-token"


@dataclass(frozen=True)
class Command:
    name: str
    args: list[str]
    env: dict[str, str] | None = None
    cwd: Path = ROOT


@dataclass(frozen=True)
class Mode:
    key: str
    label: str
    description: str
    processes: tuple[Command, ...]
    urls: tuple[tuple[str, str], ...]


def build_modes() -> dict[str, Mode]:
    base = {
        "DATABASE_URL": DATABASE_URL,
        "OPENLEASH_DEV_TOKEN": PERSONAL_TOKEN,
        "OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED": "1",
        "OPENLEASH_DEV_ORG_SLUG": "individual-open-source",
        "OPENLEASH_DEV_ORG_NAME": "Personal Open Source",
        "OPENLEASH_PIPELINE_TRACE": "1",
        "OPENLEASH_PIPELINE_TRACE_FILE": str(TRACE_FILE),
    }
    personal_api = Command("client-api", ["npx", "tsx", "src/server.ts"], {
        **base, "OPENLEASH_API_PORT": "9318", "OPENLEASH_API_SURFACE": "client",
        "OPENLEASH_DEPLOYMENT_MODE": "individual-open-source",
    }, ROOT / "apps" / "client-api")
    personal_desktop = Command("desktop-client", ["npx", "electron", "apps/desktop-client", "--show-window"], {
        **base, "OPENLEASH_CLIENT_MODE": "custom", "OPENLEASH_CLOUD_API_URL": "http://127.0.0.1:9318",
        "OPENLEASH_UPDATE_MODE": "disabled", "OPENLEASH_INSTALL_MODE": "development",
    })
    flow = Command("flow-viewer", ["node", "server.mjs"], {
        "OPENLEASH_PIPELINE_TRACE_FILE": str(TRACE_FILE), "OPENLEASH_FLOW_VIEWER_PORT": "9340",
    }, ROOT / "apps" / "flow-viewer")
    cloud_api = Command("client-api", ["npx", "tsx", "src/server.ts"], {
        **base, "OPENLEASH_API_PORT": "9318", "OPENLEASH_API_SURFACE": "client",
        "OPENLEASH_DEPLOYMENT_MODE": "cloud", "OPENLEASH_MOBILE_DEV_AUTH": "1",
        "OPENLEASH_MOBILE_DEV_EMAIL": "developer@example.com",
        "OPENLEASH_DEV_ACCOUNT_PACKAGE": "personal-managed",
    }, ROOT / "apps" / "client-api")
    cloud_desktop = Command("desktop-client", ["npx", "electron", "apps/desktop-client", "--show-window"], {
        **base, "OPENLEASH_CLIENT_MODE": "cloud", "OPENLEASH_CLOUD_API_URL": "http://127.0.0.1:9318",
        "OPENLEASH_MOBILE_DEV_AUTH": "1", "OPENLEASH_UPDATE_MODE": "disabled", "OPENLEASH_INSTALL_MODE": "development",
    })
    main_web = Command("main-web", ["npm", "run", "dev", "-w", "@openleash/main-web"], {
        **base, "OPENLEASH_MAIN_WEB_PORT": "9305", "NEXT_PUBLIC_CLOUD_CLIENT_API_URL": "http://127.0.0.1:9318",
    })
    return {
        "individual-open-source": Mode(
            "individual-open-source", "Personal Open Source",
            "Local client API, Postgres, desktop client, flow viewer, and in-process Features.",
            (flow, personal_api, personal_desktop),
            (("Client API", "http://127.0.0.1:9318/health"), ("Flow viewer", "http://127.0.0.1:9340/healthz")),
        ),
        "public-cloud": Mode(
            "public-cloud", "Leash Cloud development",
            "Personal hosted-flow simulation with client API, website, desktop, and no dashboard.",
            (flow, cloud_api, main_web, cloud_desktop),
            (("Client API", "http://127.0.0.1:9318/health"), ("Website", "http://127.0.0.1:9305"), ("Flow viewer", "http://127.0.0.1:9340/healthz")),
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the personal Leash development stack.")
    parser.add_argument("--mode", choices=["individual-open-source", "personal-open-source", "public-cloud", "leash-cloud"])
    parser.add_argument("--clean", "--cleanup-local", dest="cleanup", action="store_true")
    parser.add_argument("--clean-slate", action="store_true")
    parser.add_argument("--keep-local", action="store_true")
    parser.add_argument("--reset-data", action="store_true")
    parser.add_argument("--reset-all", action="store_true")
    parser.add_argument("--load-plugins", action="store_true", help="Compatibility flag: verifies built-in Features.")
    parser.add_argument("--plugins-dir", default=str(ROOT / "apps" / "client-api" / "src" / "plugins"))
    parser.add_argument("--dev-auth", action="store_true")
    parser.add_argument("--real-oauth", action="store_true")
    parser.add_argument("--desktop-api-url")
    parser.add_argument("--desktop-only", action="store_true")
    parser.add_argument("--view-flow", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    return parser.parse_args()


def normalize_mode(value: str) -> str:
    return {"personal-open-source": "individual-open-source", "leash-cloud": "public-cloud"}.get(value, value)


def main() -> int:
    args = parse_args()
    if args.view_flow:
        return subprocess.call(["node", "server.mjs"], cwd=ROOT / "apps" / "flow-viewer", env=merged_env({"OPENLEASH_PIPELINE_TRACE_FILE": str(TRACE_FILE)}))
    if args.cleanup:
        if args.dry_run:
            print_cleanup_dry_run()
            return 0
        if not args.yes and not confirm("Delete all local Leash containers, Postgres data, hooks, and client state?", False):
            return 1
        cleanup_local_leash(remove_data=True)
        return 0

    mode_key = normalize_mode(args.mode or choose_mode())
    mode = build_modes()[mode_key]
    clean_slate = args.clean_slate or (not args.keep_local and not args.reset_data and not args.reset_all)
    print(f"\nMode: {mode.label}\nDescription: {mode.description}")
    print("Features: first-party, built in, in-process")
    print("Dashboard / dashboard API / identity provider: not part of the public stack")
    if args.dry_run:
        for command in startup_commands(mode, clean_slate, args.desktop_only):
            print(f"[leash:{command.name}] {' '.join(command.args)}")
        return 0
    if not args.yes and not confirm("Start this run?", True):
        return 1

    TRACE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if clean_slate:
        cleanup_local_leash(remove_data=True)
    else:
        stop_dev_processes()

    children: list[subprocess.Popen[str]] = []
    try:
        for command in startup_commands(mode, False, args.desktop_only):
            if command.name.startswith("run-"):
                children.append(start_process(Command(command.name[4:], command.args, command.env, command.cwd)))
            else:
                run_step(command)
        wait_for_urls(mode.urls, children)
        print("\nLeash is ready. Press Ctrl+C to stop the development processes; Postgres data stays available.")
        while children:
            for child in children:
                if child.poll() is not None:
                    raise RuntimeError(f"A Leash process exited with code {child.returncode}")
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"[leash] error: {error}", file=sys.stderr)
        return 1
    finally:
        stop_children(children)
    return 0


def startup_commands(mode: Mode, clean_slate: bool, desktop_only: bool) -> list[Command]:
    commands: list[Command] = []
    if clean_slate:
        commands.append(Command("clean-slate", [sys.executable, str(Path(__file__).resolve()), "--clean", "--yes"]))
    if not desktop_only:
        commands.extend([
            Command("postgres", [*COMPOSE, "up", "-d", "--wait", "postgres"]),
            Command("shared-build", ["npm", "run", "build", "-w", "@openleash/shared"]),
            Command("client-build", ["npm", "run", "build", "-w", "@openleash/client-api"]),
            Command("migrate", ["npm", "run", "db:migrate", "-w", "@openleash/client-api", "--", "--apply"], {"DATABASE_URL": DATABASE_URL}),
            Command("bootstrap-personal", ["node", "apps/client-api/dist/bootstrap-personal.js", "--name", "Personal Leash", "--slug", "individual-open-source", "--mode", "private"], {"DATABASE_URL": DATABASE_URL}),
            Command("verify-features", ["npx", "tsx", "--test", "src/plugins/feature-runtime.test.ts"], None, ROOT / "apps" / "client-api"),
        ])
    commands.append(Command("desktop-build", ["npm", "run", "build", "-w", "@openleash/desktop-client"]))
    processes = tuple(process for process in mode.processes if not desktop_only or process.name == "desktop-client")
    commands.extend(Command(f"run-{process.name}", process.args, process.env, process.cwd) for process in processes)
    return commands


def run_step(command: Command) -> None:
    print(f"[leash:{command.name}] {' '.join(command.args)}")
    subprocess.run(command.args, cwd=command.cwd, env=merged_env(command.env), check=True)


def start_process(command: Command) -> subprocess.Popen[str]:
    print(f"[leash:{command.name}] {' '.join(command.args)}")
    return subprocess.Popen(command.args, cwd=command.cwd, env=merged_env(command.env), text=True)


def merged_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env.update(extra or {})
    return env


def wait_for_urls(urls: tuple[tuple[str, str], ...], children: list[subprocess.Popen[str]], timeout: int = 150) -> None:
    pending = dict(urls)
    deadline = time.time() + timeout
    while pending and time.time() < deadline:
        if any(child.poll() is not None for child in children):
            raise RuntimeError("A service exited before Leash became ready")
        for label, url in list(pending.items()):
            if http_ready(url):
                print(f"[leash:ready] {label}: {url}")
                pending.pop(label)
        if pending:
            time.sleep(0.75)
    if pending:
        raise RuntimeError("Timed out waiting for " + ", ".join(pending))


def http_ready(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1.5) as response:
            return 200 <= response.status < 500
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def stop_children(children: list[subprocess.Popen[str]]) -> None:
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            child.kill()


def stop_dev_processes() -> None:
    for pattern in ("electron apps/desktop-client", "apps/flow-viewer/server.mjs", "tsx src/server.ts"):
        subprocess.run(["pkill", "-TERM", "-f", pattern], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def cleanup_local_leash(remove_data: bool) -> None:
    print("[leash] stopping local services")
    stop_dev_processes()
    subprocess.run([*COMPOSE, "down", *( ["-v"] if remove_data else []), "--remove-orphans"], cwd=ROOT, check=False)
    for name in (
        "openleash-local-proxy", "openleash-individual-client-api", "openleash-individual-postgres",
        "openleash-plugin-gateway", "openleash-plugin-dlp", "openleash-plugin-sensitive-access",
        "openleash-plugin-rules-enforcer", "openleash-plugin-mcp-scanner", "openleash-plugin-code-scanner",
        "openleash-plugin-skill-scanner", "openleash-plugin-siem-exporter", "openleash-plugin-token-saver",
        "openleash-plugin-blast-radius",
    ):
        subprocess.run(["docker", "rm", "-f", name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if remove_data:
        for volume in ("ol2_openleash-postgres", "openleash-individual_openleash-individual-postgres"):
            subprocess.run(["docker", "volume", "rm", volume], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["npm", "run", "desktop-cli", "--", "uninstall-hooks", "--all"], cwd=ROOT, check=False)
    print("[leash] local cleanup complete")


def print_cleanup_dry_run() -> None:
    print("[leash:dry-run] stop desktop, API, flow viewer, proxy, and retired Feature containers")
    print("[leash:dry-run] docker compose down -v --remove-orphans")
    print("[leash:dry-run] uninstall all agent hooks")


def choose_mode() -> str:
    print("1. Personal Open Source\n2. Leash Cloud development")
    answer = input("Choose [default 1]: ").strip()
    return "public-cloud" if answer == "2" else "individual-open-source"


def confirm(prompt: str, default: bool) -> bool:
    suffix = " [Y/n] " if default else " [y/N] "
    value = input(prompt + suffix).strip().lower()
    return default if not value else value in {"y", "yes"}


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    raise SystemExit(main())
