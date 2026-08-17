#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Step:
    name: str
    args: list[str]
    env: dict[str, str] = field(default_factory=dict)


def main() -> int:
    parser = argparse.ArgumentParser(description="Leash release and upgrade test harness.")
    parser.add_argument("--upgrade", action="store_true", help="Run database/local-storage upgrade fixtures.")
    parser.add_argument("--full", action="store_true", help="Run the fullest local test gate: upgrade fixtures, smoke tests, flow checks, and mode dry-runs.")
    args = parser.parse_args()

    if not args.upgrade and not args.full:
        args.upgrade = True

    steps: list[Step] = []
    if args.upgrade or args.full:
        steps.extend([
            Step("postgres-upgrades", ["node", "scripts/test-postgres-upgrades.mjs"]),
            Step("native-rebuild-for-node", ["npm", "rebuild", "better-sqlite3"]),
            Step("desktop-upgrades", ["npx", "tsx", "scripts/test-desktop-upgrades.mjs"]),
        ])

    if args.full:
        steps.extend([
            Step("deployment-readiness", ["node", "scripts/check-deployment-readiness.mjs"]),
            Step("product-smoke", ["npm", "run", "smoke:product"]),
            Step("user-flows", ["npm", "run", "test:flows"]),
            Step("personal-open-source-dry-run", ["python3", "run.py", "--mode", "individual-open-source", "--dry-run", "--yes"]),
            Step("public-cloud-dry-run", ["python3", "run.py", "--mode", "public-cloud", "--dry-run", "--yes"]),
            Step("local-release-dry-run", ["python3", "run.py", "--mode", "local-release", "--dry-run", "--yes"]),
            Step("cleanup-dry-run", ["python3", "run.py", "--mode", "cleanup", "--dry-run", "--yes"]),
            Step("release-pipeline", ["python3", "-m", "unittest", "scripts/test_release_pipeline.py"]),
        ])

    for step in steps:
        run(step)

    print("\nLeash test harness passed.")
    return 0


def run(step: Step) -> None:
    print(f"\n[test:{step.name}] {' '.join(step.args)}")
    env = os.environ.copy()
    env.update(step.env)
    subprocess.run(step.args, cwd=ROOT, env=env, check=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"\n[test] failed: {' '.join(error.cmd)} exited {error.returncode}", file=sys.stderr)
        raise SystemExit(error.returncode)
