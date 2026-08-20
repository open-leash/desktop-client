#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import platform
import shutil
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
    cwd: Path = ROOT
    optional: bool = False
    reason: str = ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Leash release artifacts and deployment targets.")
    parser.add_argument("--full", action="store_true", help="Build every local release target, Docker image, and desktop distributable when supported.")
    parser.add_argument("--changed", action="store_true", help="Build changed targets only when git metadata is available; otherwise build all code targets.")
    parser.add_argument("--clean", action="store_true", help="Remove common build outputs before building.")
    parser.add_argument("--install", action="store_true", help="Run npm ci before building.")
    parser.add_argument("--docker", action="store_true", help="Build Docker images.")
    parser.add_argument("--desktop-dist", action="store_true", help="Build the personal desktop DMG on macOS.")
    parser.add_argument("--mobile", action="store_true", help="Build Flutter mobile targets when Flutter is installed.")
    parser.add_argument("--dry-run", action="store_true", help="Print commands without running them.")
    args = parser.parse_args()

    full = args.full
    targets = changed_targets() if args.changed else {"all"}
    if args.changed and targets == {"all"}:
        print("[build] git metadata unavailable or no target mapping matched; building all code targets.")

    docker = args.docker or full or (args.changed and "docker" in targets)
    desktop_dist = args.desktop_dist or full
    mobile = args.mobile or full

    steps: list[Step] = []
    if args.clean:
        steps.append(Step("clean", [sys.executable, "-c", CLEAN_SCRIPT]))
    if args.install or full:
        steps.append(Step("install", ["npm", "ci"]))
    steps.append(Step("native-rebuild", ["npm", "rebuild", "better-sqlite3"]))

    if should_build(targets, "node"):
        steps.extend([
            Step("typecheck", ["npm", "run", "typecheck"]),
            Step("public-workspaces", ["npm", "run", "build"]),
        ])

    if docker:
        # Features execute inside client-api, so only service images are built.
        steps.append(Step("docker-compose-images", ["docker", "compose", "build", "client-api"]))
        for name, target in docker_targets().items():
            steps.append(Step(f"docker-{name}", ["docker", "build", "-f", target["dockerfile"], "-t", f"openleash/{name}:local", target["context"]]))

    if desktop_dist:
        if platform.system() == "Darwin":
            steps.append(Step("desktop-personal-dmg", ["npm", "run", "dist:personal"]))
            steps.append(Step("native-rebuild-after-desktop-dist", ["npm", "rebuild", "better-sqlite3"]))
        else:
            steps.append(Step("desktop-personal-dmg", ["true"], optional=True, reason="Desktop DMG builds only run on macOS."))

    if mobile:
        if shutil.which("flutter"):
            steps.extend([
                Step("mobile-analyze", ["flutter", "analyze"], cwd=ROOT / "apps" / "mobile"),
                Step("mobile-android-debug", ["flutter", "build", "apk", "--debug"], cwd=ROOT / "apps" / "mobile"),
            ])
        else:
            steps.append(Step("mobile", ["true"], optional=True, reason="Flutter is not installed; mobile build skipped."))

    for step in steps:
        run(step, args.dry_run)

    print("\nLeash build passed.")
    return 0


def should_build(targets: set[str], target: str) -> bool:
    return "all" in targets or target in targets


def changed_targets() -> set[str]:
    if not (ROOT / ".git").exists() or not shutil.which("git"):
        return {"all"}
    try:
        merge_base = subprocess.check_output(["git", "merge-base", "HEAD", "origin/main"], cwd=ROOT, text=True).strip()
        output = subprocess.check_output(["git", "diff", "--name-only", merge_base, "HEAD"], cwd=ROOT, text=True)
    except subprocess.CalledProcessError:
        return {"all"}
    files = [line.strip() for line in output.splitlines() if line.strip()]
    if not files:
        return {"all"}
    targets: set[str] = set()
    for file in files:
        if file.startswith(("apps/", "packages/", "scripts/", "package", "tsconfig", "infra/")):
            targets.add("node")
        if file.startswith(("docker-compose", "apps/")) and file.endswith("Dockerfile"):
            targets.add("docker")
    return targets or {"all"}


def docker_targets() -> dict[str, dict[str, str]]:
    return {
        "client-api": {"dockerfile": "apps/engine/Dockerfile", "context": "."},
    }


def run(step: Step, dry_run: bool) -> None:
    if step.optional and step.reason:
        print(f"\n[build:{step.name}] skipped: {step.reason}")
        return
    print(f"\n[build:{step.name}] {' '.join(step.args)}")
    if dry_run:
        return
    env = os.environ.copy()
    env.update(step.env)
    subprocess.run(step.args, cwd=step.cwd, env=env, check=True)


CLEAN_SCRIPT = r"""
import pathlib, shutil
for pattern in [
    'apps/*/dist',
    'apps/*/.next',
    'packages/*/dist',
    'release/personal',
]:
    for path in pathlib.Path('.').glob(pattern):
        shutil.rmtree(path, ignore_errors=True)
"""


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"\n[build] failed: {' '.join(error.cmd)} exited {error.returncode}", file=sys.stderr)
        raise SystemExit(error.returncode)
