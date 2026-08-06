#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RUNTIME_POSTGRES_DIR = ROOT / "infra" / "postgres" / "migrations"
POSTGRES_CLIENTS = {"client-api"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Promote a reviewed migration draft into the shipped runtime migrations.")
    parser.add_argument("client", choices=sorted(POSTGRES_CLIENTS), help="Postgres-backed client the migration was prepared for.")
    parser.add_argument("draft", help="Reviewed draft SQL file, usually from migrations/[client]/.")
    parser.add_argument("--name", required=True, help="Human-readable migration name, for example add_billing_tables.")
    parser.add_argument("--dry-run", action="store_true", help="Print the target path without copying.")
    args = parser.parse_args()

    draft = Path(args.draft).expanduser()
    if not draft.is_absolute():
        draft = ROOT / draft
    if not draft.exists():
        raise SystemExit(f"Draft migration does not exist: {draft}")

    slug = slugify(args.name)
    if not slug:
        raise SystemExit("--name must contain at least one letter or number.")

    next_number = next_migration_number()
    target = RUNTIME_POSTGRES_DIR / f"{next_number:04d}_{slug}.sql"
    if args.dry_run:
        print(f"Would promote {draft} -> {target}")
        return 0

    RUNTIME_POSTGRES_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(draft, target)
    print(f"Promoted {draft.relative_to(ROOT)} -> {target.relative_to(ROOT)}")
    print("Review the runtime migration one more time, then run: python3 test.py --upgrade")
    return 0


def next_migration_number() -> int:
    RUNTIME_POSTGRES_DIR.mkdir(parents=True, exist_ok=True)
    numbers = []
    for file in RUNTIME_POSTGRES_DIR.glob("*.sql"):
        match = re.match(r"^(\d+)_", file.name)
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def slugify(value: str) -> str:
    return re.sub(r"(^_+|_+$)", "", re.sub(r"[^a-z0-9]+", "_", value.lower()))


if __name__ == "__main__":
    raise SystemExit(main())
