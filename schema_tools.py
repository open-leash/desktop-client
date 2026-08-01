#!/usr/bin/env python3
from __future__ import annotations

import argparse
import difflib
import os
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
SNAPSHOTS_DIR = ROOT / "snapshots"
MIGRATIONS_DIR = ROOT / "migrations"
DEFAULT_DATABASE_URL = "postgres://openleash:openleash@localhost:9543/openleash"


@dataclass(frozen=True)
class ClientConfig:
    name: str
    engine: str
    env_var: str
    default: str | None = None
    desired_schema: Path | None = None
    optional: bool = False


POSTGRES_SCHEMA = ROOT / "apps" / "client-api" / "infra" / "postgres" / "schema.sql"

CLIENTS: dict[str, ClientConfig] = {
    "client-api": ClientConfig(
        name="client-api",
        engine="postgres",
        env_var="CLIENT_API_DATABASE_URL",
        default=DEFAULT_DATABASE_URL,
        desired_schema=POSTGRES_SCHEMA,
    ),
    "cloud-client-api": ClientConfig(
        name="cloud-client-api",
        engine="postgres",
        env_var="CLOUD_CLIENT_API_DATABASE_URL",
        default=DEFAULT_DATABASE_URL,
        desired_schema=POSTGRES_SCHEMA,
    ),
    "dashboard-api": ClientConfig(
        name="dashboard-api",
        engine="postgres",
        env_var="DASHBOARD_API_DATABASE_URL",
        default=DEFAULT_DATABASE_URL,
        desired_schema=POSTGRES_SCHEMA,
    ),
    "cloud-dashboard-api": ClientConfig(
        name="cloud-dashboard-api",
        engine="postgres",
        env_var="CLOUD_DASHBOARD_API_DATABASE_URL",
        default=DEFAULT_DATABASE_URL,
        desired_schema=POSTGRES_SCHEMA,
    ),
    "desktop-client": ClientConfig(
        name="desktop-client",
        engine="sqlite",
        env_var="DESKTOP_CLIENT_SQLITE_PATH",
        default=str(Path.home() / "Library" / "Application Support" / "OpenLeash" / "personal.sqlite"),
    ),
    "mobile-client": ClientConfig(
        name="mobile-client",
        engine="sqlite",
        env_var="MOBILE_CLIENT_SQLITE_PATH",
        optional=True,
    ),
}


def load_dotenv(path: Path = ROOT / ".env") -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key:
            values[key] = value
    return values


DOTENV = load_dotenv()


def env_value(key: str) -> str | None:
    return os.environ.get(key) or DOTENV.get(key)


def client_target(config: ClientConfig) -> str | None:
    if config.engine == "postgres":
        return env_value(config.env_var) or env_value("DATABASE_URL") or config.default
    return env_value(config.env_var) or config.default


def selected_clients(names: list[str], include_optional: bool = False) -> list[ClientConfig]:
    if names:
        missing = [name for name in names if name not in CLIENTS]
        if missing:
            known = ", ".join(sorted(CLIENTS))
            raise SystemExit(f"Unknown client(s): {', '.join(missing)}. Known clients: {known}")
        return [CLIENTS[name] for name in names]

    clients: list[ClientConfig] = []
    for config in CLIENTS.values():
        if config.optional and not include_optional and not client_target(config):
            continue
        clients.append(config)
    return clients


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")


def snapshot_path(client: str, stamp: str | None = None) -> Path:
    return SNAPSHOTS_DIR / client / f"{stamp or utc_stamp()}.snap"


def migration_path(client: str, stamp: str | None = None) -> Path:
    return MIGRATIONS_DIR / client / f"{stamp or utc_stamp()}.sql"


def write_text(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    return path


def render_header(config: ClientConfig, target: str | None, source: str) -> str:
    target_label = target or "not configured"
    return "\n".join(
        [
            f"-- openleash schema snapshot",
            f"-- client: {config.name}",
            f"-- engine: {config.engine}",
            f"-- captured_at_utc: {datetime.now(timezone.utc).isoformat()}",
            f"-- source: {source}",
            f"-- target: {target_label}",
            "",
        ]
    )


def require_tool(name: str, hint: str) -> str:
    path = shutil.which(name)
    if path:
        return path
    raise RuntimeError(f"{name} was not found on PATH. {hint}")


def snapshot_postgres(config: ClientConfig, target: str | None) -> str:
    if not target:
        raise RuntimeError(f"{config.env_var} or DATABASE_URL is required for {config.name}.")
    command, source = postgres_dump_command(target)
    completed = subprocess.run(command, text=True, capture_output=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"pg_dump failed for {config.name}.")
    return render_header(config, target, source) + completed.stdout


def postgres_dump_command(target: str) -> tuple[list[str], str]:
    pg_dump = env_value("PG_DUMP") or shutil.which("pg_dump")
    if pg_dump:
        return ([
            pg_dump,
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--no-comments",
            target,
        ], "pg_dump --schema-only")

    docker_command = docker_postgres_dump_command(target)
    if docker_command:
        return docker_command

    raise RuntimeError(
        "pg_dump was not found on PATH and no compatible local Docker Postgres container was found. "
        "Install PostgreSQL client tools, set PG_DUMP=/path/to/pg_dump, or start the local dev Postgres with docker compose up -d postgres."
    )


def docker_postgres_dump_command(target: str) -> tuple[list[str], str] | None:
    if not shutil.which("docker"):
        return None
    parsed = urlparse(target)
    host = parsed.hostname or ""
    if host not in {"localhost", "127.0.0.1", "::1"}:
        return None
    if not docker_container_running("openleash-postgres"):
        return None
    user = parsed.username or "openleash"
    password = parsed.password or ""
    database = parsed.path.lstrip("/") or "openleash"
    command = [
        "docker",
        "exec",
        "-e",
        f"PGPASSWORD={password}",
        "openleash-postgres",
        "pg_dump",
        "--schema-only",
        "--no-owner",
        "--no-privileges",
        "--no-comments",
        "-U",
        user,
        "-d",
        database,
    ]
    return command, "docker exec openleash-postgres pg_dump --schema-only"


def docker_container_running(name: str) -> bool:
    completed = subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}"],
        text=True,
        capture_output=True,
        check=False,
    )
    return completed.returncode == 0 and name in completed.stdout.splitlines()


def snapshot_sqlite(config: ClientConfig, target: str | None) -> str:
    if not target:
        raise RuntimeError(f"{config.env_var} is required for {config.name}.")
    db_path = Path(target).expanduser()
    if not db_path.exists():
        raise RuntimeError(f"SQLite database does not exist for {config.name}: {db_path}")

    uri = f"file:{db_path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        rows = connection.execute(
            """
            select type, name, tbl_name, sql
            from sqlite_schema
            where sql is not null
              and name not like 'sqlite_%'
            order by
              case type
                when 'table' then 1
                when 'index' then 2
                when 'trigger' then 3
                when 'view' then 4
                else 5
              end,
              tbl_name,
              name
            """
        ).fetchall()

    statements = []
    for _, _, _, sql in rows:
        statement = sql.strip().rstrip(";")
        statements.append(f"{statement};")
    body = "\n\n".join(statements) if statements else "-- empty sqlite schema"
    return render_header(config, str(db_path), "sqlite_schema") + body + "\n"


def snapshot_client(config: ClientConfig) -> str:
    target = client_target(config)
    if config.engine == "postgres":
        return snapshot_postgres(config, target)
    if config.engine == "sqlite":
        return snapshot_sqlite(config, target)
    raise RuntimeError(f"Unsupported engine for {config.name}: {config.engine}")


def latest_snapshot(client: str) -> Path | None:
    directory = SNAPSHOTS_DIR / client
    if not directory.exists():
        return None
    snapshots = sorted(directory.glob("*.snap"))
    return snapshots[-1] if snapshots else None


def desired_schema(config: ClientConfig, desired_override: str | None = None) -> tuple[str, str]:
    if desired_override:
        path = Path(desired_override).expanduser()
        return path.read_text(encoding="utf-8"), str(path)
    if config.desired_schema:
        return config.desired_schema.read_text(encoding="utf-8"), str(config.desired_schema.relative_to(ROOT))
    return snapshot_client(config), "current live schema"


def unified_diff(previous: str, desired: str, previous_name: str, desired_name: str) -> str:
    return "".join(
        difflib.unified_diff(
            previous.splitlines(keepends=True),
            desired.splitlines(keepends=True),
            fromfile=previous_name,
            tofile=desired_name,
        )
    )


def comment_block(text: str) -> str:
    if not text:
        return "-- no schema diff"
    return "\n".join(f"-- {line}" if line else "--" for line in text.splitlines())


def build_migration(config: ClientConfig, previous_path: Path, desired_text: str, desired_source: str) -> str:
    previous_text = schema_body(previous_path.read_text(encoding="utf-8"))
    desired_text = schema_body(desired_text)
    previous_label = relative_label(previous_path)
    diff = unified_diff(previous_text, desired_text, previous_label, desired_source)
    header = "\n".join(
        [
            f"-- openleash migration candidate",
            f"-- client: {config.name}",
            f"-- engine: {config.engine}",
            f"-- generated_at_utc: {datetime.now(timezone.utc).isoformat()}",
            f"-- previous_snapshot: {previous_label}",
            f"-- desired_schema: {desired_source}",
            "--",
            "-- Review this before applying. Snapshots describe shape; they do not know data backfills,",
            "-- lock timing, destructive intent, or rollout order.",
            "",
            "-- Schema diff:",
            comment_block(diff),
            "",
        ]
    )

    if config.engine == "postgres":
        return header + "\n" + desired_text.rstrip() + "\n"

    return (
        header
        + "\nPRAGMA foreign_keys = off;\nBEGIN TRANSACTION;\n\n"
        + "-- TODO: write SQLite migration steps for the schema diff above.\n"
        + "-- Prefer additive ALTER TABLE steps and explicit data backfills.\n\n"
        + "COMMIT;\nPRAGMA foreign_keys = on;\n"
    )


def add_client_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "clients",
        nargs="*",
        help="Clients to process. Known: " + ", ".join(sorted(CLIENTS)),
    )
    parser.add_argument(
        "--include-optional",
        action="store_true",
        help="Include optional clients such as mobile-client when no explicit client list is provided.",
    )


def relative_label(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def schema_body(text: str) -> str:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "-- openleash schema snapshot":
        return text

    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "":
            return "\n".join(lines[index + 1 :]).strip() + "\n"
    return "\n".join(lines).strip() + "\n"
