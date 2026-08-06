#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent
LOCAL_DATABASE_URL = "postgres://openleash:openleash@localhost:9543/openleash"
DOTENV: dict[str, str] = {}


@dataclass(frozen=True)
class Step:
    name: str
    args: list[str]
    cwd: Path = ROOT
    env: dict[str, str] | None = None


def main() -> int:
    DOTENV.update(load_env_file(ROOT / ".env"))
    parser = argparse.ArgumentParser(
        description="Run Leash database migrations against local dev, GCP, or an explicit DATABASE_URL."
    )
    parser.add_argument("--target", choices=["local", "gcp", "custom"], help="Database target. Defaults to interactive mode.")
    parser.add_argument("--database-url", help="Explicit Postgres connection string. Implies --target custom when no target is set.")
    parser.add_argument("--scope", choices=["core", "cloud", "all"], help="Migration scope to inspect or apply.")
    parser.add_argument("--status", action="store_true", help="Show migration status without mutating the database.")
    parser.add_argument("--apply", action="store_true", help="Apply pending migrations. Required for schema changes.")
    parser.add_argument("--backup", action="store_true", help="Write a schema-only pg_dump before doing anything else.")
    parser.add_argument("--backup-apply", action="store_true", help="Write a schema-only backup, then apply pending migrations.")
    parser.add_argument("--start-local-db", action="store_true", help="Start local docker-compose Postgres before running local migrations.")
    parser.add_argument("--dry-run", action="store_true", help="Print commands without running them.")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompts.")
    args = parser.parse_args()

    if args.database_url and not args.target:
        args.target = "custom"

    if not args.target or not args.scope or not selected_action(args):
        choice = choose_migration_questionnaire(args)
    else:
        choice = args

    database_url = resolve_database_url(choice.target, choice.database_url)
    scopes = ["core", "cloud"] if choice.scope == "all" else [choice.scope]
    action = selected_action(choice)
    if not action:
        print("[migrate] choose --status, --backup, --apply, or --backup-apply", file=sys.stderr)
        return 2

    print_migration_header(choice.target, database_url, scopes, action, choice.dry_run)
    if not choice.yes and action in {"apply", "backup-apply"} and not confirm("Run database-changing migrations?", default=False):
        print("Cancelled.")
        return 130

    if choice.start_local_db or choice.target == "local":
        run_step(Step("postgres", ["docker", "compose", "up", "-d", "--wait", "postgres"]), choice.dry_run)

    for scope in scopes:
        for step in migration_steps(scope, action, database_url):
            run_step(step, choice.dry_run)

    print("[migrate] complete.")
    return 0


def choose_migration_questionnaire(args: argparse.Namespace) -> argparse.Namespace:
    print("Leash migrations")
    print("Use this to inspect or update local dev, GCP Cloud SQL, or any explicit Postgres database.")
    print("Status is read-only. Apply is explicit.\n")

    if not args.target:
        target_options = [
            ("Local dev Postgres", "postgres://openleash:****@localhost:9543/openleash", "local"),
            ("GCP Cloud SQL", "uses OPENLEASH_GCP_DATABASE_URL / OPENLEASH_CLOUD_SQL_DATABASE_URL / CLOUD_SQL_DATABASE_URL", "gcp"),
            ("Custom database URL", "paste a Postgres connection string", "custom"),
        ]
        _label, _detail, args.target = choose_option("Which database?", target_options, default=1)

    if args.target == "custom" and not args.database_url:
        args.database_url = prompt_input("DATABASE_URL: ").strip()
        if not args.database_url:
            cancel()

    if not args.scope:
        scope_options = [
            ("Core", "public client-api schema migrations", "core"),
            ("Cloud", "cloud-client-api wrapper migrations", "cloud"),
            ("All", "core first, then cloud", "all"),
        ]
        _label, _detail, args.scope = choose_option("Which migration scope?", scope_options, default=3)

    if not selected_action(args):
        action_options = [
            ("Status", "read-only migration list", "status"),
            ("Backup only", "schema-only pg_dump, no schema changes", "backup"),
            ("Apply", "apply pending migrations without backup", "apply"),
            ("Backup + apply", "backup first, then apply pending migrations", "backup-apply"),
        ]
        _label, _detail, action = choose_option("What should happen?", action_options, default=1)
        args.status = action == "status"
        args.backup = action == "backup"
        args.apply = action == "apply"
        args.backup_apply = action == "backup-apply"

    if args.target == "local":
        args.start_local_db = confirm("Start local Postgres first?", default=True)

    args.dry_run = args.dry_run or confirm("Dry run only?", default=False)
    args.yes = args.yes or confirm("Proceed?", default=True)
    if not args.yes:
        cancel()
    return args


def migration_steps(scope: str, action: str, database_url: str) -> list[Step]:
    extra_args = {
        "status": ["--status"],
        "backup": ["--backup"],
        "apply": ["--apply"],
        "backup-apply": ["--backup", "--apply"],
    }[action]
    env = {"DATABASE_URL": database_url}
    if scope == "core":
        return [Step("core-migrate", ["npm", "run", "db:migrate", "-w", "@openleash/client-api", "--", *extra_args], ROOT, env)]
    if scope == "cloud":
        return [Step("cloud-migrate", ["npx", "tsx", "src/migrate.ts", *extra_args], ROOT / "apps" / "cloud-client-api", env)]
    raise ValueError(f"unknown migration scope: {scope}")


def selected_action(args: argparse.Namespace) -> str | None:
    selected = [
        ("status", args.status),
        ("backup", args.backup),
        ("apply", args.apply),
        ("backup-apply", args.backup_apply),
    ]
    active = [name for name, value in selected if value]
    if len(active) > 1:
        print(f"[migrate] choose only one action, got: {', '.join(active)}", file=sys.stderr)
        raise SystemExit(2)
    return active[0] if active else None


def resolve_database_url(target: str, explicit: str | None) -> str:
    if explicit:
        return explicit
    if target == "local":
        return env_value("OPENLEASH_LOCAL_DATABASE_URL") or LOCAL_DATABASE_URL
    if target == "gcp":
        value = (
            env_value("OPENLEASH_GCP_DATABASE_URL")
            or env_value("OPENLEASH_CLOUD_SQL_DATABASE_URL")
            or env_value("CLOUD_SQL_DATABASE_URL")
            or env_value("GCP_DATABASE_URL")
        )
        if value:
            return value
        raise SystemExit(
            "[migrate] GCP target needs OPENLEASH_GCP_DATABASE_URL, OPENLEASH_CLOUD_SQL_DATABASE_URL, "
            "CLOUD_SQL_DATABASE_URL, GCP_DATABASE_URL, or --database-url."
        )
    raise SystemExit("[migrate] custom target needs --database-url.")


def print_migration_header(target: str, database_url: str, scopes: list[str], action: str, dry_run: bool) -> None:
    replay = ["python3", "migrate.py", "--target", target, "--scope", "all" if scopes == ["core", "cloud"] else scopes[0], f"--{action}"]
    if target == "custom":
        replay.extend(["--database-url", redact_database_url(database_url)])
    if dry_run:
        replay.append("--dry-run")
    replay.append("--yes")
    print("\nMigration run")
    print(f"  - Target: {target}")
    print(f"  - Database: {redact_database_url(database_url)}")
    print(f"  - Scope: {', '.join(scopes)}")
    print(f"  - Action: {action}")
    print(f"  - Dry run: {'yes' if dry_run else 'no'}")
    print(f"Command: {format_command(replay)}")
    sys.stdout.flush()


def run_step(step: Step, dry_run: bool) -> None:
    print(f"[migrate:{step.name}] {format_command_with_env(step)}")
    sys.stdout.flush()
    if dry_run:
        return
    subprocess.run(step.args, cwd=step.cwd, env=merged_env(step.env or {}), check=True)


def choose_option(question: str, options: list[tuple[str, str, object]], default: int = 1) -> tuple[str, str, object]:
    print(question)
    for index, (label, detail, _value) in enumerate(options, start=1):
        suffix = " [default]" if index == default else ""
        print(f"  {index}. {label} - {detail}{suffix}")
    while True:
        raw = prompt_input(f"Choose [default {default}]: ").strip()
        if not raw:
            raw = str(default)
        if raw.lower() in {"q", "quit", "exit"}:
            cancel()
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return options[int(raw) - 1]
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


def prompt_input(prompt: str) -> str:
    try:
        return input(prompt)
    except EOFError:
        cancel()


def cancel() -> None:
    print("Cancelled.")
    raise SystemExit(130)


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


def merged_env(extra: dict[str, str]) -> dict[str, str]:
    env = os.environ.copy()
    for key, value in DOTENV.items():
        env.setdefault(key, value)
    env.update(extra)
    return env


def env_value(key: str) -> str:
    return os.environ.get(key) or DOTENV.get(key, "")


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


def format_command_with_env(step: Step) -> str:
    env_parts = [
        f"{key}={redact_database_url(value) if key == 'DATABASE_URL' else value}"
        for key, value in sorted((step.env or {}).items())
    ]
    return format_command([*env_parts, *step.args])


def format_command(args: Iterable[str]) -> str:
    return " ".join(shlex.quote(str(arg)) for arg in args)


if __name__ == "__main__":
    raise SystemExit(main())
