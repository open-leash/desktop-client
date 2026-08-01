#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys

from schema_tools import (
    add_client_arguments,
    build_migration,
    desired_schema,
    latest_snapshot,
    migration_path,
    selected_clients,
    write_text,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare migration candidates from the latest schema snapshot to the desired schema."
    )
    add_client_arguments(parser)
    parser.add_argument(
        "--desired-sql",
        help="Override desired schema SQL for a single selected client.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Write a migration candidate even when no snapshot exists.",
    )
    args = parser.parse_args()

    configs = selected_clients(args.clients, include_optional=args.include_optional)
    if args.desired_sql and len(configs) != 1:
        print("--desired-sql can only be used with exactly one client.", file=sys.stderr)
        return 1

    failures: list[str] = []
    for config in configs:
        try:
            previous = latest_snapshot(config.name)
            desired_text, desired_source = desired_schema(config, args.desired_sql)
            if not previous:
                if not args.force:
                    raise RuntimeError(
                        f"No previous snapshot found in snapshots/{config.name}. "
                        "Run ./snaptshot.py first, or pass --force to create a baseline candidate."
                    )
                from pathlib import Path
                import tempfile

                temp = tempfile.NamedTemporaryFile("w", suffix=".snap", delete=False, encoding="utf-8")
                try:
                    temp.write("")
                    temp.close()
                    previous = Path(temp.name)
                    migration = build_migration(config, previous, desired_text, desired_source)
                finally:
                    Path(temp.name).unlink(missing_ok=True)
            else:
                migration = build_migration(config, previous, desired_text, desired_source)

            path = write_text(migration_path(config.name), migration)
            print(f"{config.name}: wrote {path}")
        except Exception as error:
            message = f"{config.name}: {error}"
            failures.append(message)
            print(message, file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
