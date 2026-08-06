#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys

from schema_tools import add_client_arguments, selected_clients, snapshot_client, snapshot_path, write_text


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Snapshot Leash client database schemas into snapshots/[client]/[date].snap."
    )
    add_client_arguments(parser)
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Try every selected client and report failures at the end.",
    )
    args = parser.parse_args()

    failures: list[str] = []
    for config in selected_clients(args.clients, include_optional=args.include_optional):
        try:
            output = snapshot_client(config)
            path = write_text(snapshot_path(config.name), output)
            print(f"{config.name}: wrote {path}")
        except Exception as error:
            message = f"{config.name}: {error}"
            if not args.continue_on_error:
                print(message, file=sys.stderr)
                return 1
            failures.append(message)
            print(message, file=sys.stderr)

    if failures:
        print("\nSnapshot failures:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
