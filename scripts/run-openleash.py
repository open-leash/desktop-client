#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import plistlib
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
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
PACKAGED_DESKTOP_DIR = ROOT / "release" / "personal"
LOCAL_CLOUD_API_URL = "http://127.0.0.1:9318"
PACKAGED_LOCAL_CLOUD_USER_DATA = (
    ROOT / "apps" / "desktop-client" / ".dev" / "packaged-local-cloud"
)
LOCAL_LEASH_SERVICE_PORTS = (9305, 9317, 9318, 9340)


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
        "NEXT_PUBLIC_DASHBOARD_URL": "http://localhost:9302",
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


def build_packaged_local_cloud_mode(dev_auth: bool = False) -> Mode:
    development = build_modes()["public-cloud"]
    processes: list[Command] = []
    for process in development.processes:
        if process.name == "desktop-client":
            continue
        if process.name == "client-api":
            processes.append(Command(
                process.name,
                process.args,
                {
                    **(process.env or {}),
                    "OPENLEASH_MOBILE_DEV_AUTH": "1" if dev_auth else "0",
                },
                process.cwd,
            ))
            continue
        processes.append(process)
    return Mode(
        "local-cloud-release",
        "Packaged Leash with local Cloud",
        "Release desktop connected to the local Cloud client API, website, Postgres, and flow viewer.",
        tuple(processes),
        development.urls,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the personal Leash development stack.")
    parser.add_argument(
        "--mode",
        choices=[
            "individual-open-source",
            "personal-open-source",
            "public-cloud",
            "leash-cloud",
            "local-release",
            "local-cloud-release",
            "cleanup",
        ],
    )
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
    parser.add_argument(
        "--packaged-desktop",
        action="store_true",
        help="Open the packaged Leash desktop app exactly like a downloaded app.",
    )
    parser.add_argument(
        "--packaged-desktop-path",
        type=Path,
        help="Packaged .app, .exe, or AppImage to launch instead of auto-discovery.",
    )
    parser.add_argument("--view-flow", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    return parser.parse_args()


def normalize_mode(value: str) -> str:
    return {"personal-open-source": "individual-open-source", "leash-cloud": "public-cloud"}.get(value, value)


def main() -> int:
    args = parse_args()
    if args.packaged_desktop or args.packaged_desktop_path:
        return launch_packaged_desktop(args.packaged_desktop_path, args.dry_run)
    if args.view_flow:
        return subprocess.call(["node", "server.mjs"], cwd=ROOT / "apps" / "flow-viewer", env=merged_env({"OPENLEASH_PIPELINE_TRACE_FILE": str(TRACE_FILE)}))
    if args.cleanup:
        if args.dry_run:
            print_cleanup_dry_run()
            return 0
        if not args.yes and not confirm(
            "Delete every local Leash app/binary, proxy and hook configuration, container/image, database, and client state?",
            False,
        ):
            return 1
        cleanup_local_leash(remove_data=True)
        return 0

    selected = args.mode or choose_mode()
    if selected == "local-release":
        return launch_packaged_desktop(
            None,
            args.dry_run,
            disable_updates=True,
            fresh_install=False,
            preserve_settings=True,
            rebuild=True,
        )
    if selected == "local-cloud-release":
        return run_packaged_local_cloud(args)
    if selected == "cleanup":
        if args.dry_run:
            print_cleanup_dry_run()
            return 0
        if not args.yes and not confirm(
            "Delete every local Leash app/binary, proxy and hook configuration, container/image, database, and client state?",
            False,
        ):
            return 1
        cleanup_local_leash(remove_data=True)
        return 0

    mode_key = normalize_mode(selected)
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


def run_packaged_local_cloud(args: argparse.Namespace) -> int:
    mode = build_packaged_local_cloud_mode(dev_auth=args.dev_auth and not args.real_oauth)
    print(f"\nMode: {mode.label}\nDescription: {mode.description}")
    print(f"Desktop Cloud target: {LOCAL_CLOUD_API_URL}")
    print("Authentication: development shortcut" if args.dev_auth and not args.real_oauth else "Authentication: configured local OAuth providers")
    commands = startup_commands(mode, False, False, build_desktop=False)
    if args.dry_run:
        for command in commands:
            print(f"[leash:{command.name}] {' '.join(command.args)}")
        return launch_packaged_desktop(
            None,
            True,
            disable_updates=True,
            fresh_install=False,
            preserve_settings=True,
            rebuild=True,
            remote_api_url=LOCAL_CLOUD_API_URL,
            cloud_dev_auth=args.dev_auth and not args.real_oauth,
            user_data_dir=PACKAGED_LOCAL_CLOUD_USER_DATA,
        )
    if not args.yes and not confirm("Start packaged local Cloud testing?", True):
        return 1

    TRACE_FILE.parent.mkdir(parents=True, exist_ok=True)
    stop_dev_processes()
    stop_listeners_on_ports((9305, 9318, 9340))
    children: list[subprocess.Popen[str]] = []
    try:
        for command in commands:
            if command.name.startswith("run-"):
                children.append(start_process(Command(command.name[4:], command.args, command.env, command.cwd)))
            else:
                run_step(command)
        wait_for_urls(mode.urls, children)
        launch_status = launch_packaged_desktop(
            None,
            False,
            disable_updates=True,
            fresh_install=False,
            preserve_settings=True,
            rebuild=True,
            remote_api_url=LOCAL_CLOUD_API_URL,
            cloud_dev_auth=args.dev_auth and not args.real_oauth,
            user_data_dir=PACKAGED_LOCAL_CLOUD_USER_DATA,
        )
        if launch_status != 0:
            return launch_status
        print("\nPackaged local Cloud is ready. Press Ctrl+C to stop the local services; Postgres data stays available.")
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


def startup_commands(
    mode: Mode,
    clean_slate: bool,
    desktop_only: bool,
    build_desktop: bool = True,
) -> list[Command]:
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
    if build_desktop:
        commands.append(Command("desktop-build", ["npm", "run", "build", "-w", "@openleash/desktop-client"]))
    processes = tuple(process for process in mode.processes if not desktop_only or process.name == "desktop-client")
    commands.extend(Command(f"run-{process.name}", process.args, process.env, process.cwd) for process in processes)
    return commands


def run_step(command: Command) -> None:
    if command.name == "postgres" and tcp_ready("127.0.0.1", 9543):
        print("[leash:postgres] existing local Postgres is ready on port 9543")
        return
    print(f"[leash:{command.name}] {' '.join(command.args)}")
    subprocess.run(command.args, cwd=command.cwd, env=merged_env(command.env), check=True)


def start_process(command: Command) -> subprocess.Popen[str]:
    print(f"[leash:{command.name}] {' '.join(command.args)}")
    return subprocess.Popen(command.args, cwd=command.cwd, env=merged_env(command.env), text=True)


def merged_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env.pop("ELECTRON_RUN_AS_NODE", None)
    for key, value in root_env().items():
        if is_local_oauth_env_key(key):
            env.setdefault(key, value)
    env.update(extra or {})
    return env


def root_env() -> dict[str, str]:
    path = ROOT / ".env"
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def is_local_oauth_env_key(key: str) -> bool:
    return key.startswith((
        "OPENLEASH_GOOGLE_",
        "OPENLEASH_MICROSOFT_",
        "OPENLEASH_GITHUB_",
    )) or key in {
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "MICROSOFT_CLIENT_ID",
        "MICROSOFT_CLIENT_SECRET",
        "AZURE_CLIENT_ID",
        "AZURE_CLIENT_SECRET",
        "AZURE_TENANT_ID",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
    }


def tcp_ready(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


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
    for pattern in (
        "electron apps/desktop-client",
        "apps/flow-viewer/server.mjs",
        "tsx src/server.ts",
        "tsx watch src/server.ts",
        "tsx/dist/cli.mjs watch src/server.ts",
        "next dev -p 9305",
    ):
        subprocess.run(["pkill", "-TERM", "-f", pattern], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop_listeners_on_ports(ports: tuple[int, ...]) -> None:
    if shutil.which("lsof") is None:
        return
    pids: set[int] = set()
    for port in ports:
        result = subprocess.run(
            ["lsof", "-tiTCP:" + str(port), "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )
        pids.update(
            int(value)
            for value in result.stdout.splitlines()
            if value.strip().isdigit()
        )
    current_group = os.getpgrp()
    process_groups: set[int] = set()
    direct_pids: set[int] = set()
    for pid in pids:
        try:
            process_group = os.getpgid(pid)
        except ProcessLookupError:
            continue
        if process_group != current_group:
            process_groups.add(process_group)
        else:
            direct_pids.add(pid)
    for process_group in sorted(process_groups):
        try:
            os.killpg(process_group, signal.SIGTERM)
        except ProcessLookupError:
            continue
    for pid in sorted(direct_pids):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
    deadline = time.time() + 5
    while (process_groups or direct_pids) and time.time() < deadline:
        process_groups = {
            process_group
            for process_group in process_groups
            if process_group_is_running(process_group)
        }
        direct_pids = {pid for pid in direct_pids if process_is_running(pid)}
        if process_groups or direct_pids:
            time.sleep(0.1)
    for process_group in sorted(process_groups):
        try:
            os.killpg(process_group, signal.SIGKILL)
        except ProcessLookupError:
            continue
    for pid in sorted(direct_pids):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            continue


def process_is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def process_group_is_running(process_group: int) -> bool:
    try:
        os.killpg(process_group, 0)
        return True
    except ProcessLookupError:
        return False


def cleanup_local_leash(remove_data: bool) -> None:
    print("[leash] stopping local services")
    stop_dev_processes()
    stop_listeners_on_ports(LOCAL_LEASH_SERVICE_PORTS)
    stop_installed_app_processes()
    cleanup_installed_app_integrations()
    stop_installed_app_processes()
    subprocess.run(["npm", "run", "desktop-cli", "--", "proxy", "uninstall"], cwd=ROOT, check=True)
    subprocess.run(["npm", "run", "desktop-cli", "--", "uninstall-hooks", "--all"], cwd=ROOT, check=True)
    remove_macos_registrations()
    subprocess.run([*COMPOSE, "down", *( ["-v"] if remove_data else []), "--remove-orphans"], cwd=ROOT, check=False)
    subprocess.run(["docker", "compose", "--project-name", "ol2", "down", *( ["-v"] if remove_data else []), "--remove-orphans"], cwd=ROOT, check=False)
    for name in discover_local_leash_containers():
        subprocess.run(["docker", "rm", "-f", name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if remove_data:
        for volume in discover_local_leash_volumes():
            subprocess.run(["docker", "volume", "rm", volume], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for network in discover_local_leash_networks():
            subprocess.run(["docker", "network", "rm", network], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        image_ids = discover_local_leash_image_ids()
        if image_ids:
            subprocess.run(["docker", "image", "rm", "-f", *image_ids], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for target in local_state_paths():
            remove_path(target)
    print("[leash] local cleanup complete")


def stop_installed_app_processes() -> None:
    if sys.platform == "darwin":
        labels = {
            "com.openleash.installer-launch",
            "com.openleash.local-release-launch",
            *discover_running_leash_launch_jobs(),
        }
        for label in sorted(labels):
            subprocess.run(
                ["launchctl", "remove", label],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    patterns = ("/Leash.app/", "/OpenLeash.app/")
    for pattern in patterns:
        subprocess.run(
            ["pkill", "-TERM", "-f", pattern],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    deadline = time.time() + 4
    while time.time() < deadline:
        if not any(
            subprocess.run(
                ["pgrep", "-f", pattern],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode == 0
            for pattern in patterns
        ):
            return
        time.sleep(0.2)
    for pattern in patterns:
        subprocess.run(
            ["pkill", "-KILL", "-f", pattern],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def cleanup_installed_app_integrations(candidates: tuple[Path, ...] | None = None) -> None:
    candidates = candidates or (
        Path("/Applications/Leash.app/Contents/MacOS/Leash"),
        Path("/Applications/OpenLeash.app/Contents/MacOS/OpenLeash"),
        Path.home() / "Applications" / "Leash.app" / "Contents" / "MacOS" / "Leash",
        Path.home() / "Applications" / "OpenLeash.app" / "Contents" / "MacOS" / "OpenLeash",
    )
    for executable in candidates:
        if not executable.is_file():
            continue
        print(f"[leash:cleanup-integrations] {executable} --cleanup-integrations")
        env = merged_env()
        env.pop("ELECTRON_RUN_AS_NODE", None)
        try:
            with tempfile.TemporaryDirectory(prefix="leash-cleanup-") as user_data_dir:
                result = subprocess.run(
                    [
                        str(executable),
                        f"--user-data-dir={user_data_dir}",
                        "--cleanup-integrations",
                    ],
                    env=env,
                    check=False,
                    timeout=15,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                )
        except (OSError, subprocess.TimeoutExpired) as error:
            print(
                f"[leash:cleanup-integrations] packaged helper unavailable ({error}); "
                "continuing with native proxy and hook cleanup"
            )
            continue
        if result.returncode != 0:
            detail = (result.stderr or "").strip().splitlines()
            suffix = f": {detail[-1]}" if detail else ""
            print(
                "[leash:cleanup-integrations] packaged helper exited "
                f"with status {result.returncode}{suffix}; continuing with native proxy and hook cleanup"
            )


def remove_macos_registrations() -> None:
    if sys.platform != "darwin":
        return
    for label in discover_local_leash_launch_agents():
        subprocess.run(
            ["launchctl", "bootout", f"gui/{os.getuid()}/{label}"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    for login_name in ("Leash", "OpenLeash"):
        script = (
            'tell application "System Events" to '
            f'if exists login item "{login_name}" then delete login item "{login_name}"'
        )
        subprocess.run(["osascript", "-e", script], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    lsregister = Path("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
    if lsregister.is_file():
        registered = subprocess.run(
            [str(lsregister), "-dump"],
            capture_output=True,
            text=True,
            check=False,
        )
        app_paths = set(parse_registered_leash_app_paths(registered.stdout))
        app_paths.update({
            Path("/Applications/Leash.app"),
            Path("/Applications/OpenLeash.app"),
            Path.home() / "Applications" / "Leash.app",
            Path.home() / "Applications" / "OpenLeash.app",
        })
        for app_path in sorted(app_paths, key=str):
            subprocess.run([str(lsregister), "-u", "-R", str(app_path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run([str(lsregister), "-gc"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for image_path, detach_targets in discover_macos_leash_disk_images():
        for detach_target in detach_targets:
            subprocess.run(["hdiutil", "detach", str(detach_target), "-quiet"], check=False)
        if str(image_path).startswith(("/tmp/", "/private/tmp/", "/var/folders/")):
            remove_path(image_path)


def parse_registered_leash_app_paths(output: str) -> list[Path]:
    paths: set[Path] = set()
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped.startswith("path:"):
            continue
        raw_path = stripped.removeprefix("path:").strip().rsplit(" (0x", 1)[0].strip()
        candidate = Path(raw_path)
        name = candidate.name.lower()
        if name.startswith(("leash", "openleash")):
            paths.add(candidate)
    return sorted(paths, key=str)


def discover_macos_leash_disk_images() -> list[tuple[Path, tuple[Path, ...]]]:
    if sys.platform != "darwin":
        return []
    result = subprocess.run(
        ["hdiutil", "info", "-plist"],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    try:
        document = plistlib.loads(result.stdout)
    except plistlib.InvalidFileException:
        return []
    images: list[tuple[Path, tuple[Path, ...]]] = []
    for image in document.get("images", []):
        raw_image_path = image.get("image-path")
        if not isinstance(raw_image_path, str) or "leash" not in Path(raw_image_path).name.lower():
            continue
        detach_targets = tuple(
            Path(entity.get("mount-point") or entity["dev-entry"])
            for entity in image.get("system-entities", [])
            if isinstance(entity, dict)
            and (
                isinstance(entity.get("mount-point"), str)
                or isinstance(entity.get("dev-entry"), str)
            )
        )
        images.append((Path(raw_image_path), detach_targets))
    return images


def discover_local_leash_containers() -> list[str]:
    result = subprocess.run(
        ["docker", "ps", "-a", "--format", "{{.Names}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return sorted(
        {
            name
            for name in result.stdout.splitlines()
            if name.lower().startswith(("openleash", "leash-", "ol2-"))
        }
    )


def discover_local_leash_volumes() -> list[str]:
    result = subprocess.run(
        ["docker", "volume", "ls", "--format", "{{.Name}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return sorted(
        {
            name
            for name in result.stdout.splitlines()
            if name.lower().startswith(("openleash", "leash-", "ol2_"))
        }
    )


def discover_local_leash_networks() -> list[str]:
    result = subprocess.run(
        ["docker", "network", "ls", "--format", "{{.Name}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return sorted(
        {
            name
            for name in result.stdout.splitlines()
            if name.lower().startswith(("openleash", "leash-", "ol2_"))
        }
    )


def is_local_leash_image_repository(repository: str) -> bool:
    return repository.lower().startswith(
        (
            "ghcr.io/open-leash/",
            "ghcr.io/openleash/",
            "openleash/",
            "openleash-",
            "open-leash/",
            "leash/",
            "leash-",
        )
    )


def discover_local_leash_image_ids() -> list[str]:
    result = subprocess.run(
        ["docker", "image", "ls", "--format", "{{.Repository}} {{.ID}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    image_ids: set[str] = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) == 2 and is_local_leash_image_repository(parts[0]):
            image_ids.add(parts[1])
    return sorted(image_ids)


def discover_local_leash_launch_agents() -> list[str]:
    launch_agents = Path.home() / "Library" / "LaunchAgents"
    labels: list[str] = []
    if launch_agents.is_dir():
        for pattern in ("com.openleash*.plist", "com.leash*.plist"):
            labels.extend(path.stem for path in launch_agents.glob(pattern))
    labels.extend(discover_running_leash_launch_jobs())
    return sorted(set(labels))


def parse_leash_launchctl_labels(output: str) -> list[str]:
    labels: set[str] = set()
    for line in output.splitlines():
        fields = line.split()
        if not fields:
            continue
        label = fields[-1]
        if label.startswith(("com.openleash.", "com.leash.")):
            labels.add(label)
    return sorted(labels)


def discover_running_leash_launch_jobs() -> list[str]:
    if sys.platform != "darwin":
        return []
    result = subprocess.run(
        ["launchctl", "list"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return parse_leash_launchctl_labels(result.stdout or "")


def local_state_paths() -> tuple[Path, ...]:
    user_home = Path.home()
    temp_roots = {Path(tempfile.gettempdir()), Path("/tmp")}
    command_names = ("leash", "leash-client", "leash-agent", "openleash", "openleash-client", "openleash-agent")
    command_roots = (Path("/usr/local/bin"), Path("/opt/homebrew/bin"), user_home / ".local" / "bin")
    fixed = {
        user_home / ".openleash",
        user_home / "Library" / "Application Support" / "Leash",
        user_home / "Library" / "Application Support" / "OpenLeash",
        user_home / "Library" / "Application Support" / "OpenLeash (Dev)",
        user_home / "Library" / "Logs" / "Leash",
        user_home / "Library" / "Logs" / "OpenLeash",
        user_home / "Library" / "WebKit" / "leash-island",
        user_home / "Library" / "WebKit" / "openleash-island",
        user_home / "Library" / "Caches" / "leash-island",
        user_home / "Library" / "Caches" / "openleash-island",
        user_home / "Library" / "Saved Application State" / "com.openleash.personal.savedState",
        user_home / "Library" / "Saved Application State" / "com.openleash.openleash.savedState",
        Path("/Applications/Leash.app"),
        Path("/Applications/OpenLeash.app"),
        user_home / "Applications" / "Leash.app",
        user_home / "Applications" / "OpenLeash.app",
        ROOT / "apps" / "desktop-client" / ".dev" / "Leash.app",
        ROOT / "apps" / "desktop-client" / ".dev" / "OpenLeash.app",
        PACKAGED_LOCAL_CLOUD_USER_DATA,
        Path("/tmp/openleash-startup.log"),
        Path("/tmp/openleash-launch.log"),
        TRACE_FILE,
    }
    fixed.update(command_root / command_name for command_root in command_roots for command_name in command_names)
    for temp_root in temp_roots:
        for pattern in ("leash-cleanup-*", "openleash-cleanup-*"):
            fixed.update(temp_root.glob(pattern))
    library = user_home / "Library"
    glob_roots = (
        library / "Application Support" / "CrashReporter",
        library / "Caches",
        library / "Containers",
        library / "HTTPStorages",
        library / "LaunchAgents",
        library / "Preferences",
        library / "Preferences" / "ByHost",
        library / "WebKit",
    )
    for root in glob_roots:
        if not root.is_dir():
            continue
        iterator = root.rglob("*") if root.name == "Caches" else root.glob("*")
        for candidate in iterator:
            name = candidate.name.lower()
            if "openleash" in name or name in {"leash", "leash.plist"} or name.startswith("com.leash."):
                fixed.add(candidate)
    return tuple(sorted(fixed, key=lambda path: (len(path.parts), str(path)), reverse=True))


def remove_path(target: Path) -> None:
    print(f"[leash:remove] {target}")
    try:
        if target.is_symlink() or target.is_file():
            target.unlink(missing_ok=True)
        elif target.exists():
            shutil.rmtree(target)
    except PermissionError:
        print(f"[leash:remove] permission denied: {target}")


def print_cleanup_dry_run() -> None:
    print(
        "[leash:dry-run] stop desktop, local Cloud website/API, flow viewer, "
        "proxy, and all Leash containers"
    )
    print("[leash:dry-run] docker compose down -v --remove-orphans")
    print("[leash:dry-run] restore proxy configuration and uninstall all agent hooks")
    print("[leash:dry-run] remove login items, launch agents, protocol/app registrations, Docker images, volumes, and networks")
    print(
        "[leash:dry-run] delete local binaries, client state, settings, caches, "
        "logs, installed app copies, and the packaged local-Cloud profile"
    )


def packaged_desktop_candidates(release_dir: Path = PACKAGED_DESKTOP_DIR) -> list[Path]:
    if sys.platform == "darwin":
        candidates = [
            *release_dir.glob("*/Leash.app"),
            *release_dir.glob("*/OpenLeash.app"),
            release_dir / "Leash.app",
            release_dir / "OpenLeash.app",
        ]
    elif sys.platform == "win32":
        candidates = [
            release_dir / "win-unpacked" / "Leash.exe",
            release_dir / "win-unpacked" / "OpenLeash.exe",
        ]
    else:
        candidates = [
            *release_dir.glob("Leash*.AppImage"),
            *release_dir.glob("OpenLeash*.AppImage"),
            release_dir / "linux-unpacked" / "leash",
            release_dir / "linux-unpacked" / "openleash",
        ]
    existing = {candidate.resolve() for candidate in candidates if candidate.exists()}
    return sorted(
        existing,
        key=lambda candidate: (
            candidate.stat().st_mtime,
            candidate.name.lower().startswith("leash"),
        ),
        reverse=True,
    )


def packaged_desktop_command(
    app_path: Path,
    disable_updates: bool = False,
    fresh_install: bool = False,
    preserve_settings: bool = False,
    remote_api_url: str | None = None,
    cloud_dev_auth: bool = False,
    user_data_dir: Path | None = None,
) -> list[str]:
    app_args: list[str] = ["--show-window"]
    if user_data_dir:
        app_args.append(f"--user-data-dir={user_data_dir}")
    if disable_updates:
        app_args.extend(["--update-mode", "disabled"])
    if fresh_install:
        app_args.append("--fresh-install")
    elif preserve_settings:
        app_args.append("--keep-settings")
    if remote_api_url:
        app_args.extend(["--remote-api-url", remote_api_url])
    if sys.platform == "darwin" and app_path.suffix.lower() == ".app":
        executable = app_path / "Contents" / "MacOS" / "Leash"
        cloud_environment = [
            "OPENLEASH_CLIENT_MODE=cloud",
            f"OPENLEASH_CLOUD_API_URL={remote_api_url}",
            f"OPENLEASH_MOBILE_DEV_AUTH={'1' if cloud_dev_auth else '0'}",
        ] if remote_api_url else []
        return [
            "launchctl",
            "submit",
            "-l",
            "com.openleash.local-release-launch",
            "--",
            "/usr/bin/env",
            "-u",
            "ELECTRON_RUN_AS_NODE",
            *cloud_environment,
            str(executable),
            *app_args,
        ]
    return [str(app_path), *app_args]


def packaged_desktop_is_ready(app_path: Path) -> bool:
    executable = app_path / "Contents" / "MacOS" / "Leash"
    process = subprocess.run(
        ["pgrep", "-f", f"^{executable}"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return process.returncode == 0 and http_ready("http://127.0.0.1:9317/health")


def stop_packaged_desktop_process(app_path: Path) -> None:
    if sys.platform != "darwin":
        return
    executable = app_path / "Contents" / "MacOS" / "Leash"
    pattern = f"^{executable}"
    subprocess.run(
        ["pkill", "-TERM", "-f", pattern],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 8
    while time.time() < deadline:
        running = subprocess.run(
            ["pgrep", "-f", pattern],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode == 0
        if not running:
            return
        time.sleep(0.1)
    subprocess.run(
        ["pkill", "-KILL", "-f", pattern],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def launch_packaged_desktop(
    requested_path: Path | None,
    dry_run: bool = False,
    disable_updates: bool = False,
    fresh_install: bool = False,
    preserve_settings: bool = False,
    rebuild: bool = False,
    remote_api_url: str | None = None,
    cloud_dev_auth: bool = False,
    user_data_dir: Path | None = None,
) -> int:
    if rebuild:
        build_command = ["npm", "run", "dist:windows" if sys.platform == "win32" else "dist:personal"]
        print(f"[leash:packaged-desktop] rebuilding current source: {' '.join(build_command)}")
        if not dry_run:
            try:
                subprocess.run(build_command, cwd=ROOT, env=merged_env(), check=True)
            except subprocess.CalledProcessError as error:
                print(f"[leash] Packaged desktop build failed with code {error.returncode}.", file=sys.stderr)
                return error.returncode
    app_path = requested_path.expanduser().resolve() if requested_path else None
    if app_path is None:
        candidates = packaged_desktop_candidates()
        app_path = candidates[0] if candidates else None
    if app_path is None or not app_path.exists():
        build_command = "npm run dist:windows" if sys.platform == "win32" else "npm run dist:personal"
        missing = f" at {app_path}" if app_path else ""
        print(f"[leash] No packaged desktop app was found{missing}.", file=sys.stderr)
        print(f"[leash] Build it first with: {build_command}", file=sys.stderr)
        return 1
    command = packaged_desktop_command(
        app_path,
        disable_updates,
        fresh_install,
        preserve_settings,
        remote_api_url,
        cloud_dev_auth,
        user_data_dir,
    )
    print(f"[leash:packaged-desktop] newest built app: {app_path}")
    if fresh_install:
        print("[leash] Opening this local release artifact as a clean installation with automatic updates disabled.")
    elif disable_updates:
        print("[leash] Opening this local release artifact with automatic updates disabled.")
    else:
        print("[leash] Opening the release build with normal user settings and no development services.")
    if dry_run:
        print(f"[leash:dry-run] {' '.join(command)}")
        return 0
    if user_data_dir:
        user_data_dir.mkdir(parents=True, exist_ok=True)
    if fresh_install:
        cleanup_local_leash(remove_data=True)
    env = merged_env({
        **({
            "OPENLEASH_CLIENT_MODE": "cloud",
            "OPENLEASH_CLOUD_API_URL": remote_api_url,
            "OPENLEASH_MOBILE_DEV_AUTH": "1" if cloud_dev_auth else "0",
        } if remote_api_url else {}),
    })
    try:
        if sys.platform == "darwin":
            subprocess.run(
                ["launchctl", "remove", "com.openleash.local-release-launch"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            stop_packaged_desktop_process(app_path)
            completed = subprocess.run(command, cwd=ROOT, env=env, check=False)
            if completed.returncode != 0:
                return completed.returncode
            deadline = time.time() + 20
            while time.time() < deadline:
                if packaged_desktop_is_ready(app_path):
                    print("[leash:ready] packaged desktop: http://127.0.0.1:9317/health")
                    return 0
                time.sleep(0.25)
            print("[leash] Packaged desktop did not become healthy after launch.", file=sys.stderr)
            return 1
        subprocess.Popen(
            command,
            cwd=ROOT,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as error:
        print(f"[leash] Could not open the packaged desktop app: {error}", file=sys.stderr)
        return 1
    return 0


def choose_mode() -> str:
    print(
        "1. Personal Open Source\n"
        "2. Leash Cloud development\n"
        "3. Rebuild and open the newest macOS release (release/personal)\n"
        "4. Rebuild packaged desktop with the local Leash Cloud stack\n"
        "C. Delete all local Leash data"
    )
    answer = input("Choose [default 1]: ").strip()
    if answer.lower() in {"c", "clean", "cleanup", "delete"}:
        return "cleanup"
    if answer in {"3"} or answer.lower() in {"app", "desktop", "packaged", "release"}:
        return "local-release"
    if answer in {"4"} or answer.lower() in {"local-cloud", "packaged-cloud", "cloud-release"}:
        return "local-cloud-release"
    return "public-cloud" if answer == "2" else "individual-open-source"


def confirm(prompt: str, default: bool) -> bool:
    suffix = " [Y/n] " if default else " [y/N] "
    value = input(prompt + suffix).strip().lower()
    return default if not value else value in {"y", "yes"}


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    raise SystemExit(main())
