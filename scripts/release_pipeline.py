#!/usr/bin/env python3
"""Deterministic, resumable Leash production release pipeline.

This module is invoked through ``python3 release.py --production``.  It owns
the ordering between independent repositories; it does not use an LLM and it
does not infer release scope from prose or git history.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = Path.home() / ".openleash-release"
DEFAULT_CLOUD_API = "https://api.openleash.com"
DEFAULT_MAIN_WEB = "https://openleash.com"


@dataclass(frozen=True)
class Component:
    key: str
    path: Path
    github: str
    kind: str
    test_commands: tuple[tuple[str, ...], ...]
    build_commands: tuple[tuple[str, ...], ...]


COMPONENTS: dict[str, Component] = {
    "shared": Component(
        "shared", ROOT / "packages/shared", "open-leash/shared", "tag",
        (("npm", "run", "typecheck", "-w", "@openleash/shared"),),
        (("npm", "run", "build", "-w", "@openleash/shared"),),
    ),
    "client-api": Component(
        "client-api", ROOT / "apps/client-api", "open-leash/client-api", "container",
        (
            ("node", "scripts/test-postgres-upgrades.mjs"),
            ("npm", "run", "test", "-w", "@openleash/client-api"),
            ("npm", "run", "typecheck", "-w", "@openleash/client-api"),
        ),
        (("npm", "run", "build", "-w", "@openleash/client-api"),),
    ),
    "local-proxy": Component(
        "local-proxy", ROOT / "apps/local-proxy", "open-leash/local-proxy", "container",
        (("cargo", "test", "--manifest-path", "apps/local-proxy/Cargo.toml"),),
        (),
    ),
    "cloud-client-api": Component(
        "cloud-client-api", ROOT / "apps/cloud-client-api", "open-leash/cloud-client-api", "cloud",
        (
            ("npm", "test"),
            ("npm", "run", "typecheck"),
            ("node", "scripts/test-cloud-postgres-upgrades.mjs"),
        ),
        (("npm", "run", "build"),),
    ),
    "desktop-client": Component(
        "desktop-client", ROOT / "apps/desktop-client", "open-leash/desktop-client", "desktop",
        (
            ("npm", "run", "verify:release-dependencies", "-w", "@openleash/desktop-client"),
            ("npm", "run", "test", "-w", "@openleash/desktop-client"),
            ("npm", "run", "typecheck", "-w", "@openleash/desktop-client"),
            ("npx", "tsx", "scripts/test-desktop-upgrades.mjs"),
        ),
        (
            ("npm", "run", "build", "-w", "@openleash/desktop-client"),
            ("npm", "run", "dist:personal"),
            ("node", "scripts/verify-packaged-desktop.mjs"),
            ("bash", "scripts/smoke-macos-installer.sh"),
        ),
    ),
    "main-web": Component(
        "main-web", ROOT / "apps/main-web", "open-leash/main-web", "web",
        (
            ("npm", "run", "test:installer-wrapper", "-w", "@openleash/main-web"),
            ("npm", "run", "typecheck", "-w", "@openleash/main-web"),
        ),
        (("docker", "build", "--no-cache", "-t", "openleash/main-web:release-gate", "apps/main-web"),),
    ),
}

ORDER = ("shared", "client-api", "local-proxy", "cloud-client-api", "desktop-client", "main-web")
ALIASES = {
    "packages/shared": "shared",
    "apps/client-api": "client-api",
    "apps/local-proxy": "local-proxy",
    "apps/cloud-client-api": "cloud-client-api",
    "cloud-api": "cloud-client-api",
    "apps/desktop-client": "desktop-client",
    "desktop": "desktop-client",
    "apps/main-web": "main-web",
    "web": "main-web",
}


class Journal:
    def __init__(self, path: Path, document: dict[str, Any], dry_run: bool):
        self.path = path
        self.document = document
        self.dry_run = dry_run

    @property
    def completed(self) -> set[str]:
        return set(self.document.setdefault("completed", []))

    def output(self, step: str) -> Any:
        return self.document.setdefault("outputs", {}).get(step)

    def run(self, step: str, action: Callable[[], Any]) -> Any:
        if step in self.completed:
            print(f"[release:resume] {step}")
            return self.output(step)
        print(f"\n[release:stage] {step}")
        if self.dry_run:
            return None
        value = action()
        self.document.setdefault("outputs", {})[step] = value
        self.document.setdefault("completed", []).append(step)
        self.save()
        return value

    def save(self) -> None:
        if self.dry_run:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(self.document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(self.path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic Leash production release pipeline (tests, migrations, artifacts, deploys, live verification)."
    )
    parser.add_argument("--app", "--component", action="append", dest="apps", default=[], help="Component and optional version, e.g. client-api=0.37.4. Repeatable.")
    parser.add_argument("--version", help="Version for components that do not specify one explicitly.")
    parser.add_argument("--ship", action="store_true", help="Execute the complete commit, publish, deploy, and verify pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Print the complete ordered plan without changing local or remote state.")
    parser.add_argument("--yes", action="store_true", help="Required with --ship; confirms the explicit component/version plan.")
    parser.add_argument("--resume", type=Path, help="Resume an interrupted release from its state JSON.")
    parser.add_argument("--state-file", type=Path, help="Write resumable release state to this path.")
    parser.add_argument("--desktop-channel", choices=("terminal", "stable"), default="terminal", help="Terminal is locally signed and installed through install.sh; stable requires Apple signing/notarization secrets.")
    parser.add_argument("--migration-target", choices=("gcp", "custom"), default="gcp", help="Production Postgres target used before cloud-client-api deployment.")
    parser.add_argument("--database-url", help="Explicit production Postgres URL for --migration-target custom.")
    parser.add_argument("--cloud-source-only", action="store_true", help="Push cloud-client-api source but do not migrate, deploy, or verify production.")
    parser.add_argument("--cloud-api-url", default=DEFAULT_CLOUD_API)
    parser.add_argument("--main-web-url", default=DEFAULT_MAIN_WEB)
    parser.add_argument("--rollout", type=int, default=100, help="Desktop stable update rollout percentage.")
    parser.add_argument("--timeout", type=int, default=1800, help="Maximum seconds for each remote workflow/deployment gate.")
    args = parser.parse_args(argv)

    if not args.dry_run and not args.ship:
        parser.error("choose --dry-run or --ship")
    if args.ship and not args.yes:
        parser.error("--ship requires --yes")
    if not 0 <= args.rollout <= 100:
        parser.error("--rollout must be between 0 and 100")
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")

    if args.resume:
        document = json.loads(args.resume.resolve().read_text(encoding="utf-8"))
        requested = {key: str(value) for key, value in document["versions"].items()}
        args.desktop_channel = str(document.get("desktop_channel", args.desktop_channel))
        explicit_components = set(document.get("explicit_components", requested))
        state_path = args.resume.resolve()
    else:
        requested = parse_selection(args.apps, args.version)
        explicit_components = set(requested)
        requested = add_required_surfaces(requested)
        if not requested:
            parser.error("select at least one component with --app")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%fZ")
        state_path = (args.state_file or STATE_DIR / f"production-{stamp}.json").resolve()
        document = {
            "format": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "versions": requested,
            "explicit_components": sorted(explicit_components),
            "desktop_channel": args.desktop_channel,
            "config": {
                "cloud_source_only": args.cloud_source_only,
                "cloud_api_url": args.cloud_api_url,
                "main_web_url": args.main_web_url,
                "migration_target": args.migration_target,
                "rollout": args.rollout,
            },
            "completed": [],
            "outputs": {},
        }

    if args.resume:
        config = document.get("config", {})
        args.cloud_source_only = bool(config.get("cloud_source_only", args.cloud_source_only))
        args.cloud_api_url = str(config.get("cloud_api_url", args.cloud_api_url))
        args.main_web_url = str(config.get("main_web_url", args.main_web_url))
        args.migration_target = str(config.get("migration_target", args.migration_target))
        args.rollout = int(config.get("rollout", args.rollout))

    selected = [key for key in ORDER if key in requested]
    args.explicit_components = explicit_components
    print_plan(selected, requested, args, state_path)
    if args.dry_run:
        print_dry_run_stages(selected, args)
        return 0

    journal = Journal(state_path, document, dry_run=False)
    journal.save()
    journal.run("preflight", lambda: preflight(selected, requested, args))
    journal.run("product-contract", lambda: run_command(("npm", "run", "test:flows"), ROOT))

    released: dict[str, dict[str, str]] = dict(journal.document.setdefault("released", {}))
    for key in selected:
        component = COMPONENTS[key]
        version = requested[key]
        journal.run(f"{key}:prepare", lambda c=component, v=version: prepare_component(c, v, released, requested, args))
        journal.run(f"{key}:gates", lambda c=component: run_component_gates(c))
        commit = journal.run(f"{key}:commit", lambda c=component, v=version: commit_component(c, v))
        if commit is None:
            commit = git(component.path, "rev-parse", "HEAD").strip()

        if key == "cloud-client-api" and not args.cloud_source_only:
            journal.run("cloud-client-api:migrate", lambda: run_cloud_migrations(args, "backup-apply"))

        journal.run(f"{key}:push", lambda c=component, v=version: push_component(c, v, args))
        publication = journal.run(
            f"{key}:publish",
            lambda c=component, v=version, sha=commit: publish_component(c, v, sha, args),
        ) or {}
        released[key] = {"version": version, "commit": commit, **publication}
        journal.document["released"] = released
        journal.save()

        if key == "client-api":
            digest = released[key].get("digest")
            if not digest:
                raise RuntimeError("client-api publication did not return an immutable digest")
            journal.run("client-api:pin-consumers", lambda d=digest, v=version: pin_client_api_consumers(v, d))
            journal.run("public-core:commit-pins", lambda: commit_and_push_root_pins("Update Personal Open Source client API release"))
            journal.run("client-api:published-image-smoke", lambda d=digest, v=version: smoke_personal_image(v, d))
        elif key == "local-proxy":
            digest = released[key].get("digest")
            if not digest:
                raise RuntimeError("local-proxy publication did not return an immutable digest")
            journal.run("local-proxy:pin-desktop", lambda d=digest, v=version: pin_local_proxy(v, d))

    if "cloud-client-api" in selected and not args.cloud_source_only:
        journal.run("cloud-client-api:migration-status", lambda: run_cloud_migrations(args, "status"))
        cloud_version = requested["cloud-client-api"]
        journal.run(
            "cloud-client-api:live-health",
            lambda: wait_for_json_health(
                f"{args.cloud_api_url.rstrip('/')}/cloud/health",
                "openleash-cloud-client-api",
                cloud_version,
                args.timeout,
            ),
        )
    if "main-web" in selected:
        desktop_version = requested.get("desktop-client")
        journal.run(
            "main-web:live-installer",
            lambda: wait_for_live_installer(args.main_web_url, desktop_version, args.timeout),
        )

    journal.document["finished_at"] = datetime.now(timezone.utc).isoformat()
    journal.save()
    print(f"\n[release] production release complete. State: {journal.path}")
    return 0


def parse_selection(values: list[str], common_version: str | None) -> dict[str, str]:
    selected: dict[str, str] = {}
    for raw in values:
        name, separator, explicit = raw.partition("=")
        key = ALIASES.get(name.strip().strip("/"), name.strip().removeprefix("apps/").removeprefix("packages/"))
        if key not in COMPONENTS:
            raise SystemExit(f"Unknown release component: {name}")
        version = explicit.strip() if separator else common_version or next_patch(component_version(COMPONENTS[key]))
        validate_version(version)
        selected[key] = version
    return selected


def add_required_surfaces(selected: dict[str, str]) -> dict[str, str]:
    result = dict(selected)
    if "client-api" in result or "local-proxy" in result:
        result.setdefault("desktop-client", next_patch(component_version(COMPONENTS["desktop-client"])))
    if "desktop-client" in result:
        result.setdefault("main-web", next_patch(component_version(COMPONENTS["main-web"])))
    return result


def print_plan(selected: list[str], versions: dict[str, str], args: argparse.Namespace, state_path: Path) -> None:
    print("Leash deterministic production release")
    for key in selected:
        print(f"  - {key}: {component_version(COMPONENTS[key])} -> {versions[key]}")
    print(f"  - desktop channel: {args.desktop_channel}")
    print(f"  - cloud migrations: {'source only' if args.cloud_source_only else args.migration_target + ' backup + apply + status'}")
    print(f"  - state: {state_path}")


def print_dry_run_stages(selected: list[str], args: argparse.Namespace) -> None:
    print("\nOrdered stages:")
    print("  1. preflight branches, remotes, tools, versions, and append-only migrations")
    print("  2. public product contract")
    number = 3
    for key in selected:
        print(f"  {number}. {key}: prepare -> test/build -> commit -> push -> publish/deploy -> verify")
        number += 1
        if key == "client-api":
            print(f"  {number}. pin the published client-api digest; test the actual Personal Open Source image")
            number += 1
    print(f"  {number}. production migration status and live cloud health (when selected)")
    print(f"  {number + 1}. live main-web install.sh download/checksum verification (when selected)")
    if args.desktop_channel == "terminal":
        print("  - macOS artifacts use the release-gated Terminal installer workflow")


def preflight(selected: list[str], versions: dict[str, str], args: argparse.Namespace) -> dict[str, Any]:
    required = {"git", "node", "npm", "gh", "curl"}
    if any(key in selected for key in ("client-api", "cloud-client-api", "desktop-client", "main-web")):
        required.add("docker")
    if "local-proxy" in selected:
        required.add("cargo")
    missing = sorted(tool for tool in required if not shutil.which(tool))
    if missing:
        raise RuntimeError(f"Missing release tools: {', '.join(missing)}")
    if "desktop-client" in selected and platform.system() != "Darwin":
        raise RuntimeError("The local desktop release gate must run on macOS.")
    run_command(("gh", "auth", "status"), ROOT)
    checked: dict[str, str] = {}
    if "client-api" in selected:
        git(ROOT, "fetch", "origin", "main")
        root_behind = int(git(ROOT, "rev-list", "--count", "HEAD..origin/main").strip() or "0")
        if root_behind:
            raise RuntimeError(f"public core is {root_behind} commit(s) behind origin/main")
        generated_paths = ("scripts/install-openleash-personal.sh", "deploy/docker/individual-open-source.compose.yml")
        if git(ROOT, "status", "--porcelain", "--", *generated_paths).strip():
            raise RuntimeError("Personal Open Source release pin files already have local edits; commit or restore them before release.")
    for key in selected:
        component = COMPONENTS[key]
        if not (component.path / ".git").exists():
            raise RuntimeError(f"Missing repository checkout: {component.path}")
        branch = git(component.path, "branch", "--show-current").strip()
        if branch != "main":
            raise RuntimeError(f"{key} must be released from main, found {branch!r}")
        git(component.path, "fetch", "origin", "main", "--tags")
        behind = int(git(component.path, "rev-list", "--count", "HEAD..origin/main").strip() or "0")
        if behind:
            raise RuntimeError(f"{key} is {behind} commit(s) behind origin/main")
        validate_version(versions[key])
        if not args.resume and semver_core(versions[key]) <= semver_core(component_version(component)):
            raise RuntimeError(
                f"{key} release version {versions[key]} must be greater than current {component_version(component)}"
            )
        if key not in args.explicit_components and git(component.path, "status", "--porcelain").strip():
            raise RuntimeError(
                f"{key} was added automatically but already has local changes; select it explicitly to include them"
            )
        remote_tag = git(component.path, "ls-remote", "--tags", "origin", f"refs/tags/v{versions[key]}").strip()
        if remote_tag and not args.resume:
            raise RuntimeError(f"{component.github} already has immutable tag v{versions[key]}; choose a new version or resume its state file")
        checked[key] = git(component.path, "rev-parse", "HEAD").strip()
    if "client-api" in selected:
        validate_append_only_migrations(COMPONENTS["client-api"].path, Path("infra/postgres/migrations"))
    if "cloud-client-api" in selected:
        for dependency_key in ("shared", "client-api"):
            if dependency_key in selected:
                continue
            dependency = COMPONENTS[dependency_key]
            git(dependency.path, "fetch", "origin", "main")
            head = git(dependency.path, "rev-parse", "HEAD").strip()
            remote = git(dependency.path, "rev-parse", "origin/main").strip()
            if head != remote or git(dependency.path, "status", "--porcelain").strip():
                raise RuntimeError(
                    f"cloud-client-api dependency {dependency_key} must be a clean origin/main checkout or explicitly selected"
                )
        validate_append_only_migrations(COMPONENTS["cloud-client-api"].path, Path("infra/postgres/migrations"))
        if not args.cloud_source_only:
            resolve_migration_database(args)
            run_cloud_migrations(args, "status")
    return checked


def validate_append_only_migrations(repo: Path, directory: Path) -> None:
    changes = git(repo, "diff", "--name-status", "origin/main", "--", str(directory))
    for line in changes.splitlines():
        status = line.split(maxsplit=1)[0]
        if status != "A":
            raise RuntimeError(f"Applied migration history is append-only; found {line}")


def prepare_component(component: Component, version: str, released: dict[str, dict[str, str]], requested: dict[str, str], args: argparse.Namespace) -> dict[str, Any]:
    if component.key == "client-api" and "shared" in released:
        pin_shared_dependency(component.path, released["shared"]["version"], released["shared"]["commit"])
    elif component.key == "cloud-client-api":
        shared = released.get("shared") or current_release_identity(COMPONENTS["shared"])
        client = released.get("client-api") or current_release_identity(COMPONENTS["client-api"])
        pin_cloud_dependencies(shared, client)
    elif component.key == "desktop-client" and "shared" in released:
        pin_desktop_shared(released["shared"]["version"])
    bump_component_version(component, version)
    if component.key == "desktop-client":
        command = [
            "node", "scripts/prepare-desktop-release.mjs", "--version", version,
            "--download-host", "github", "--links-only",
        ]
        if args.desktop_channel == "terminal":
            command.append("--terminal-installer")
        else:
            command.append("--include-windows")
        run_command(tuple(command), ROOT)
    return {"version": version}


def run_component_gates(component: Component) -> None:
    if component.key in {"client-api", "desktop-client", "main-web"}:
        run_command(("npm", "run", "test:flows"), ROOT)
    for command in component.test_commands:
        cwd = component.path if component.key == "cloud-client-api" and command[0] == "npm" else ROOT
        run_command(command, cwd)
    for command in component.build_commands:
        cwd = component.path if component.key == "cloud-client-api" and command[0] == "npm" else ROOT
        run_command(command, cwd)


def commit_component(component: Component, version: str) -> str:
    git(component.path, "add", "-A")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=component.path).returncode == 1:
        git(component.path, "commit", "-m", f"Release {component.key} {version}")
    elif component_version(component) != version:
        raise RuntimeError(f"{component.key} has no releasable changes and is not already v{version}")
    return git(component.path, "rev-parse", "HEAD").strip()


def push_component(component: Component, version: str, args: argparse.Namespace) -> dict[str, str]:
    git(component.path, "push", "origin", "HEAD:main")
    if component.kind == "desktop" and args.desktop_channel == "terminal":
        return {"commit": git(component.path, "rev-parse", "HEAD").strip()}
    ensure_tag(component, version)
    git(component.path, "push", "origin", f"v{version}")
    if component.kind == "desktop" and args.desktop_channel == "stable":
        ensure_github_release(component.github, version, prerelease=False)
    return {"tag": f"v{version}"}


def publish_component(component: Component, version: str, commit: str, args: argparse.Namespace) -> dict[str, str]:
    if component.kind == "container":
        wait_for_workflow(component.github, "publish-container.yml", commit, args.timeout)
        digest = wait_for_ghcr_digest(component.github.split("/", 1)[1], version, args.timeout)
        return {"digest": digest}
    if component.kind == "desktop":
        if args.desktop_channel == "terminal":
            output = capture((
                "gh", "workflow", "run", "release-terminal-macos.yml", "--repo", component.github,
                "-f", f"release_tag=v{version}",
            ), ROOT)
            match = re.search(r"/actions/runs/(\d+)", output)
            if not match:
                raise RuntimeError(f"Could not identify dispatched desktop workflow: {output.strip()}")
            run_command(("gh", "run", "watch", match.group(1), "--repo", component.github, "--exit-status"), ROOT)
            verify_desktop_release(component.github, version, terminal=True)
        else:
            wait_for_workflow(component.github, "release-macos.yml", commit, args.timeout)
            wait_for_workflow(component.github, "release-windows.yml", commit, args.timeout)
            verify_desktop_release(component.github, version, terminal=False)
            run_command((
                "node", "scripts/publish-desktop-update.mjs", "--version", version,
                "--rollout", str(args.rollout), "--api", args.cloud_api_url,
            ), ROOT)
        return {"release": f"https://github.com/{component.github}/releases/tag/v{version}"}
    if component.kind in {"cloud", "web"}:
        if component.kind == "cloud" and args.cloud_source_only:
            return {"source_only": "true"}
        wait_for_checks(component.github, commit, args.timeout, required_app="Google Cloud Build")
        return {"deployed_commit": commit}
    return {"tag": f"v{version}"}


def wait_for_workflow(repo: str, workflow: str, commit: str, timeout: int) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        command = ["gh", "run", "list", "--repo", repo, "--workflow", workflow, "--limit", "10", "--json", "databaseId,headSha,status,conclusion,createdAt"]
        runs = json.loads(capture(command, ROOT))
        matching = [run for run in runs if run.get("headSha") == commit]
        if matching:
            run = matching[0]
            run_id = str(run["databaseId"])
            run_command(("gh", "run", "watch", run_id, "--repo", repo, "--exit-status"), ROOT)
            return
        time.sleep(3)
    raise RuntimeError(f"Timed out waiting for {repo} workflow {workflow} at {commit}")


def wait_for_checks(repo: str, commit: str, timeout: int, required_app: str | None = None) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        payload = json.loads(capture(("gh", "api", f"repos/{repo}/commits/{commit}/check-runs"), ROOT))
        checks = payload.get("check_runs") or []
        if required_app:
            checks = [check for check in checks if check.get("app", {}).get("name") == required_app]
        if checks and all(check.get("status") == "completed" for check in checks):
            failures = [check for check in checks if check.get("conclusion") not in {"success", "neutral", "skipped"}]
            if failures:
                raise RuntimeError(f"Deployment checks failed for {repo}: {[(check.get('name'), check.get('conclusion')) for check in failures]}")
            return
        time.sleep(5)
    raise RuntimeError(f"Timed out waiting for deployment checks on {repo}@{commit}")


def wait_for_ghcr_digest(repository: str, version: str, timeout: int) -> str:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            return resolve_ghcr_digest(repository, version)
        except (RuntimeError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(3)
    raise RuntimeError(f"Timed out waiting for GHCR {repository}:{version}: {last_error}")


def resolve_ghcr_digest(repository: str, version: str) -> str:
    scope = urllib.parse.quote(f"repository:open-leash/{repository}:pull", safe="")
    token_payload = fetch_json(f"https://ghcr.io/token?service=ghcr.io&scope={scope}")
    token = token_payload.get("token")
    if not token:
        raise RuntimeError(f"GHCR did not issue an anonymous token for {repository}:{version}")
    request = urllib.request.Request(
        f"https://ghcr.io/v2/open-leash/{repository}/manifests/{version}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        digest = response.headers.get("Docker-Content-Digest", "")
        manifest = json.load(response)
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise RuntimeError(f"GHCR returned an invalid digest for {repository}:{version}: {digest!r}")
    platforms = {
        f"{entry.get('platform', {}).get('os')}/{entry.get('platform', {}).get('architecture')}"
        for entry in manifest.get("manifests", [])
        if entry.get("platform", {}).get("architecture") != "unknown"
    }
    missing = {"linux/amd64", "linux/arm64"} - platforms
    if missing:
        raise RuntimeError(f"{repository}:{version} is missing platforms: {', '.join(sorted(missing))}")
    return digest


def pin_client_api_consumers(version: str, digest: str) -> dict[str, str]:
    value = f"{version}@{digest}"
    files = [
        ROOT / "scripts/install-openleash-personal.sh",
        ROOT / "deploy/docker/individual-open-source.compose.yml",
        ROOT / "apps/desktop-client/src/main.ts",
    ]
    for file in files:
        source = file.read_text(encoding="utf-8")
        updated = replace_client_api_pin_text(source, value)
        if updated == source:
            raise RuntimeError(f"Client API release pin was not found in {file.relative_to(ROOT)}")
        file.write_text(updated, encoding="utf-8")
    return {"version": version, "digest": digest}


def replace_client_api_pin_text(source: str, value: str) -> str:
    return re.sub(
        r"client-api:(\\?)\$\{OPENLEASH_VERSION:-[^}]+\}",
        lambda match: f"client-api:{match.group(1)}${{OPENLEASH_VERSION:-{value}}}",
        source,
    )


def pin_local_proxy(version: str, digest: str) -> dict[str, str]:
    image = f"ghcr.io/open-leash/local-proxy:{version}@{digest}"
    for file in (
        ROOT / "apps/desktop-client/src/proxy-manager.ts",
        ROOT / "apps/desktop-client/src/proxy-manager.test.ts",
    ):
        replace_regex(file, r"ghcr\.io/open-leash/local-proxy:[0-9A-Za-z.+-]+@sha256:[a-f0-9]{64}", image)
    return {"image": image}


def pin_shared_dependency(repo: Path, version: str, commit: str) -> None:
    update_json_dependency(repo / "package.json", "@openleash/shared", version)
    dockerfile = repo / "Dockerfile"
    replace_regex(dockerfile, r"ARG OPENLEASH_SHARED_REF=[a-f0-9]{40}", f"ARG OPENLEASH_SHARED_REF={commit}")


def pin_cloud_dependencies(shared: dict[str, str], client: dict[str, str]) -> None:
    repo = COMPONENTS["cloud-client-api"].path
    update_json_dependency(repo / "package.json", "@openleash/shared", shared["version"])
    update_json_dependency(repo / "package.json", "@openleash/client-api", client["version"])
    dockerfile = repo / "Dockerfile"
    replace_regex(dockerfile, r"ARG OPENLEASH_SHARED_REF=[a-f0-9]{40}", f"ARG OPENLEASH_SHARED_REF={shared['commit']}")
    replace_regex(dockerfile, r"ARG OPENLEASH_CLIENT_API_REF=[a-f0-9]{40}", f"ARG OPENLEASH_CLIENT_API_REF={client['commit']}")
    replace_regex(dockerfile, r"value\.dependencies\['@openleash/shared'\]='[^']+'", f"value.dependencies['@openleash/shared']='{shared['version']}'")
    replace_regex(dockerfile, r"value\.dependencies\['@openleash/client-api'\]='[^']+'", f"value.dependencies['@openleash/client-api']='{client['version']}'")


def pin_desktop_shared(version: str) -> None:
    repo = COMPONENTS["desktop-client"].path
    update_json_dependency(repo / "package.json", "@openleash/shared", version)
    for workflow in ("release-macos.yml", "release-windows.yml", "release-terminal-macos.yml"):
        replace_regex(repo / ".github/workflows" / workflow, r"ref: v[0-9]+\.[0-9]+\.[0-9]+", f"ref: v{version}")


def bump_component_version(component: Component, version: str) -> None:
    package = component.path / "package.json"
    cargo = component.path / "Cargo.toml"
    pubspec = component.path / "pubspec.yaml"
    if package.exists():
        data = json.loads(package.read_text(encoding="utf-8"))
        data["version"] = version
        package.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    elif cargo.exists():
        replace_regex(cargo, r'^version\s*=\s*"[^"]+"', f'version = "{version}"', flags=re.MULTILINE)
    elif pubspec.exists():
        replace_regex(pubspec, r"^version:\s*[^\n]+", f"version: {version}+1", flags=re.MULTILINE)


def update_json_dependency(path: Path, name: str, version: str) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    dependencies = data.setdefault("dependencies", {})
    dependencies[name] = version
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def replace_regex(path: Path, pattern: str, replacement: str | Callable[[re.Match[str]], str], flags: int = 0) -> None:
    source = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, source, flags=flags)
    if count == 0:
        raise RuntimeError(f"Release pin pattern was not found in {path.relative_to(ROOT)}: {pattern}")
    path.write_text(updated, encoding="utf-8")


def commit_and_push_root_pins(message: str) -> dict[str, str]:
    paths = ["scripts/install-openleash-personal.sh", "deploy/docker/individual-open-source.compose.yml"]
    git(ROOT, "add", "--", *paths)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 1:
        git(ROOT, "commit", "-m", message)
        git(ROOT, "push", "origin", "HEAD:main")
    return {"commit": git(ROOT, "rev-parse", "HEAD").strip()}


def smoke_personal_image(version: str, digest: str) -> dict[str, str]:
    image = f"ghcr.io/open-leash/client-api:{version}@{digest}"
    run_command(("bash", "scripts/smoke-personal-release.sh", image), ROOT)
    return {"image": image}


def run_cloud_migrations(args: argparse.Namespace, action: str) -> dict[str, str]:
    command = ["python3", "migrate.py", "--target", args.migration_target, "--scope", "all", f"--{action}", "--yes"]
    if args.database_url:
        command.extend(("--database-url", args.database_url))
    run_command(tuple(command), ROOT)
    return {"target": args.migration_target, "action": action}


def resolve_migration_database(args: argparse.Namespace) -> str:
    if args.database_url:
        return args.database_url
    if args.migration_target == "custom":
        raise RuntimeError("--migration-target custom requires --database-url")
    for key in ("OPENLEASH_GCP_DATABASE_URL", "OPENLEASH_CLOUD_SQL_DATABASE_URL", "CLOUD_SQL_DATABASE_URL", "GCP_DATABASE_URL"):
        if os.environ.get(key):
            return os.environ[key]
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() in {"OPENLEASH_GCP_DATABASE_URL", "OPENLEASH_CLOUD_SQL_DATABASE_URL", "CLOUD_SQL_DATABASE_URL", "GCP_DATABASE_URL"} and value.strip():
                return value.strip().strip("\"'")
    raise RuntimeError("Cloud deployment requires a production database URL for backup and migrations.")


def verify_desktop_release(repo: str, version: str, terminal: bool) -> None:
    release = fetch_json(f"https://api.github.com/repos/{repo}/releases/tags/v{version}")
    if release.get("draft"):
        raise RuntimeError(f"Desktop v{version} is still a draft")
    assets = {asset.get("name"): asset for asset in release.get("assets", [])}
    expected = (
        {f"Leash-{version}-terminal-installer-arm64.dmg", "install-openleash-personal-terminal.sh", "SHA256SUMS-TERMINAL"}
        if terminal else
        {f"Leash-{version}-arm64.dmg", f"Leash-{version}-x64-Setup.exe", "install-openleash-personal.sh", "SHA256SUMS", "SHA256SUMS-WINDOWS"}
    )
    missing = expected - set(assets)
    if missing:
        raise RuntimeError(f"Desktop release v{version} is missing: {', '.join(sorted(missing))}")
    for name in expected:
        if int(assets[name].get("size") or 0) <= 0:
            raise RuntimeError(f"Desktop release asset is empty: {name}")


def verify_live_installer(main_web_url: str, expected_version: str | None) -> dict[str, str]:
    url = f"{main_web_url.rstrip('/')}/install.sh?release_verify={int(time.time())}"
    script = fetch_bytes(url).decode("utf-8")
    if expected_version and f'OPENLEASH_DESKTOP_VERSION="${{OPENLEASH_DESKTOP_VERSION:-{expected_version}}}"' not in script:
        raise RuntimeError(f"Live install.sh does not select desktop v{expected_version}")
    env = os.environ.copy()
    env["OPENLEASH_INSTALL_VERIFY_ONLY"] = "1"
    completed = subprocess.run(["bash"], input=script, text=True, capture_output=True, env=env)
    if completed.returncode != 0 or "Verified installer and DMG checksums." not in completed.stdout:
        raise RuntimeError(f"Live install.sh verification failed: {completed.stderr.strip()}")
    print(completed.stdout.strip())
    return {"url": url, "sha256": hashlib.sha256(script.encode()).hexdigest()}


def wait_for_live_installer(main_web_url: str, expected_version: str | None, timeout: int) -> dict[str, str]:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            return verify_live_installer(main_web_url, expected_version)
        except (RuntimeError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(5)
    raise RuntimeError(f"Timed out waiting for the live installer: {last_error}")


def verify_json_health(url: str, service: str, expected_version: str | None = None) -> dict[str, Any]:
    payload = fetch_json(f"{url}?release_verify={int(time.time())}")
    if payload.get("ok") is not True or payload.get("service") != service:
        raise RuntimeError(f"Unexpected health response from {url}: {payload}")
    if expected_version is not None and payload.get("version") != expected_version:
        raise RuntimeError(
            f"{service} is healthy but has version {payload.get('version')!r}; expected newly released {expected_version!r}"
        )
    return payload


def wait_for_json_health(url: str, service: str, expected_version: str, timeout: int) -> dict[str, Any]:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            return verify_json_health(url, service, expected_version)
        except (RuntimeError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(5)
    raise RuntimeError(f"Timed out waiting for {service} {expected_version}: {last_error}")


def current_release_identity(component: Component) -> dict[str, str]:
    commit = git(component.path, "rev-parse", "origin/main").strip()
    package_text = git(component.path, "show", "origin/main:package.json", check=False)
    version = str(json.loads(package_text)["version"]) if package_text.strip() else component_version(component)
    return {"version": version, "commit": commit}


def component_version(component: Component) -> str:
    package = component.path / "package.json"
    cargo = component.path / "Cargo.toml"
    pubspec = component.path / "pubspec.yaml"
    if package.exists():
        return str(json.loads(package.read_text(encoding="utf-8"))["version"])
    source = (cargo if cargo.exists() else pubspec).read_text(encoding="utf-8")
    pattern = r'^version\s*=\s*"([^"]+)"' if cargo.exists() else r"^version:\s*([0-9]+\.[0-9]+\.[0-9]+)"
    match = re.search(pattern, source, re.MULTILINE)
    if not match:
        raise RuntimeError(f"Could not read version for {component.key}")
    return match.group(1)


def next_patch(version: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", version)
    if not match:
        raise SystemExit(f"Cannot bump non-semver version: {version}")
    major, minor, patch = (int(value) for value in match.groups())
    return f"{major}.{minor}.{patch + 1}"


def validate_version(version: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Production releases require a stable x.y.z semantic version: {version}")


def semver_core(version: str) -> tuple[int, int, int]:
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)", version)
    if not match:
        raise RuntimeError(f"Invalid semantic version: {version}")
    return tuple(int(value) for value in match.groups())


def ensure_tag(component: Component, version: str) -> None:
    tag = f"v{version}"
    current = git(component.path, "rev-parse", "HEAD").strip()
    existing = git(component.path, "rev-list", "-n", "1", tag, check=False).strip()
    if existing:
        if existing != current:
            raise RuntimeError(f"{component.github} {tag} already points to {existing}, not {current}")
        return
    git(component.path, "tag", "-a", tag, "-m", f"Release {component.key} {version}")


def ensure_github_release(repo: str, version: str, prerelease: bool) -> None:
    exists = subprocess.run(["gh", "release", "view", f"v{version}", "--repo", repo], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if exists:
        return
    command = ["gh", "release", "create", f"v{version}", "--repo", repo, "--verify-tag", "--title", f"Leash {version}", "--generate-notes"]
    if prerelease:
        command.append("--prerelease")
    run_command(tuple(command), ROOT)


def run_command(command: tuple[str, ...], cwd: Path) -> None:
    rendered = " ".join(redact(argument) for argument in command)
    print(f"[release:run] ({cwd.relative_to(ROOT) if cwd != ROOT else '.'}) {rendered}")
    subprocess.run(list(command), cwd=cwd, check=True)


def capture(command: tuple[str, ...] | list[str], cwd: Path) -> str:
    completed = subprocess.run(list(command), cwd=cwd, text=True, capture_output=True)
    if completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, command, completed.stdout, completed.stderr)
    return completed.stdout


def git(repo: Path, *arguments: str, check: bool = True) -> str:
    completed = subprocess.run(["git", *arguments], cwd=repo, text=True, capture_output=True)
    if check and completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, ["git", *arguments], completed.stdout, completed.stderr)
    return completed.stdout


def fetch_json(url: str) -> dict[str, Any]:
    return json.loads(fetch_bytes(url))


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "leash-release-pipeline", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def redact(value: str) -> str:
    if value.startswith(("postgres://", "postgresql://")):
        return re.sub(r"://([^:]+):[^@]+@", r"://\1:****@", value)
    return value


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError, urllib.error.URLError) as error:
        print(f"\n[release] failed: {error}", file=sys.stderr)
        raise SystemExit(1)
