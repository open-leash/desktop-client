#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_BACKUP_DIR = ROOT.parent / "ol2-backup"
DEFAULT_REPO = "mnns/ol2-backup"
CHUNK_SIZE = 49 * 1024 * 1024
DEFAULT_EXCLUDES = (
    "node_modules",
    ".next",
    "dist",
    "build",
    ".turbo",
    ".vercel",
    "coverage",
    ".playwright-cli",
    "__pycache__",
    ".dart_tool",
    ".gradle",
    "Pods",
    ".symlinks",
    "DerivedData",
    "release",
    "output",
    "*.tsbuildinfo",
    "*.log",
    "*.dmg",
    "*.pkg",
    "*.msi",
    "*.exe",
    "*.app",
    "*.ipa",
    "*.aab",
    "*.apk",
)


RESTORE_SCRIPT = r'''#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore the encrypted OL2 backup in this repo.")
    parser.add_argument("--target", default="../OL2-restored", help="Directory to extract the restored OL2 folder into.")
    parser.add_argument("--password", help="Encryption password. If omitted, you will be prompted.")
    parser.add_argument("--overwrite", action="store_true", help="Allow extracting into an existing target directory.")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parent
    manifest = json.loads((repo / "manifest.json").read_text(encoding="utf-8"))
    target = Path(args.target).expanduser().resolve()
    if target.exists() and any(target.iterdir()) and not args.overwrite:
        raise SystemExit(f"Target exists and is not empty: {target}. Use --overwrite if this is intentional.")

    password = args.password or getpass.getpass("Backup password: ")
    parts = [repo / name for name in manifest["chunks"]]
    for part in parts:
        if not part.exists():
            raise SystemExit(f"Missing backup chunk: {part.name}")

    with tempfile.TemporaryDirectory(prefix="ol2-restore-") as tmp:
        encrypted = Path(tmp) / "ol2.tar.gz.enc"
        with encrypted.open("wb") as out:
            for part in parts:
                out.write(part.read_bytes())
        digest = sha256_file(encrypted)
        if digest != manifest["encrypted_sha256"]:
            raise SystemExit("Encrypted archive checksum mismatch. Backup chunks may be incomplete.")

        archive = Path(tmp) / "ol2.tar.gz"
        env = os.environ.copy()
        env["OL2_BACKUP_PASSWORD"] = password
        run([
            "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", str(manifest["openssl_iter"]),
            "-in", str(encrypted), "-out", str(archive), "-pass", "env:OL2_BACKUP_PASSWORD"
        ], env=env)

        target.mkdir(parents=True, exist_ok=True)
        run(["tar", "-xzf", str(archive), "-C", str(target)])

    print(f"Restored backup into {target}")
    print("The extracted folder contains the nested app .git repos exactly as archived.")
    return 0


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], env: dict[str, str] | None = None) -> None:
    completed = subprocess.run(command, env=env)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
'''


def main() -> int:
    parser = argparse.ArgumentParser(description="Create an encrypted full-folder OL2 backup and push it to private GitHub.")
    parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR), help="Local checkout for the backup repo.")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub repo in owner/name form.")
    parser.add_argument("--branch", default="main", help="Backup repo branch.")
    parser.add_argument("--keep-history", action="store_true", help="Keep normal git history instead of force-pushing a single rolling snapshot.")
    parser.add_argument("--include-generated", action="store_true", help="Also include generated/reinstallable dependency and build folders.")
    parser.add_argument("--password", help="Encryption password. If omitted, you will be prompted.")
    parser.add_argument("--chunk-mb", type=int, default=49, help="Chunk size. Defaults below GitHub's 50MB warning threshold.")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen without archiving or pushing.")
    args = parser.parse_args()

    if args.chunk_mb < 10 or args.chunk_mb > 95:
        raise SystemExit("--chunk-mb must be between 10 and 95")

    backup_dir = Path(args.backup_dir).expanduser().resolve()
    chunk_size = args.chunk_mb * 1024 * 1024
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")

    require_tool("git")
    require_tool("tar")
    require_tool("openssl")
    require_tool("gh")

    print(f"[backup] source: {ROOT}")
    print(f"[backup] repo checkout: {backup_dir}")
    print(f"[backup] github repo: {args.repo} ({'history' if args.keep_history else 'rolling latest snapshot'})")
    if args.include_generated:
        print("[backup] including generated dependencies/build outputs")
    else:
        print("[backup] excluding reinstallable/generated folders like node_modules, build outputs, Pods, and caches")

    if args.dry_run:
        print("[backup] dry run only")
        return 0

    password = args.password or prompt_password()
    ensure_github_repo(args.repo)
    ensure_backup_checkout(backup_dir, args.repo, args.branch)

    with tempfile.TemporaryDirectory(prefix="ol2-backup-") as tmp_name:
        tmp = Path(tmp_name)
        archive = tmp / f"ol2-{timestamp}.tar.gz"
        encrypted = tmp / f"ol2-{timestamp}.tar.gz.enc"

        print("[backup] creating tar.gz archive; this can take a while for a full OL2 backup")
        create_archive(archive, backup_dir, include_generated=args.include_generated)

        print("[backup] encrypting archive with openssl aes-256-cbc pbkdf2")
        encrypt_archive(archive, encrypted, password)
        archive.unlink()

        encrypted_sha = sha256_file(encrypted)
        encrypted_size = encrypted.stat().st_size

        prepare_backup_worktree(backup_dir, keep_history=args.keep_history, branch=args.branch)
        chunks = split_archive(encrypted, backup_dir, chunk_size)
        write_restore_files(
            backup_dir=backup_dir,
            repo=args.repo,
            branch=args.branch,
            timestamp=timestamp,
            chunks=chunks,
            chunk_size=chunk_size,
            encrypted_size=encrypted_size,
            encrypted_sha=encrypted_sha,
            include_generated=args.include_generated,
        )

    commit_message = f"OL2 encrypted backup {timestamp}"
    run(["git", "add", "-A"], cwd=backup_dir)
    if not has_changes(backup_dir):
        print("[backup] no changes to commit")
        return 0
    run(["git", "commit", "-m", commit_message], cwd=backup_dir)

    if args.keep_history:
        run(["git", "push", "origin", args.branch], cwd=backup_dir)
    else:
        run(["git", "push", "--force-with-lease", "origin", args.branch], cwd=backup_dir)

    print(f"[backup] pushed encrypted backup to https://github.com/{args.repo}")
    print(f"[backup] restore: clone {args.repo}, then run python3 restore_ol2_backup.py")
    return 0


def prompt_password() -> str:
    first = getpass.getpass("Backup encryption password: ")
    second = getpass.getpass("Repeat password: ")
    if first != second:
        raise SystemExit("Passwords did not match.")
    if len(first) < 8:
        raise SystemExit("Use at least 8 characters for the backup password.")
    return first


def require_tool(tool: str) -> None:
    if shutil.which(tool):
        return
    raise SystemExit(f"Missing required tool: {tool}")


def ensure_github_repo(repo: str) -> None:
    result = subprocess.run(["gh", "repo", "view", repo], text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode == 0:
        return
    print(f"[backup] creating private GitHub repo {repo}")
    run(["gh", "repo", "create", repo, "--private", "--description", "Encrypted OL2 full-folder backups"])


def ensure_backup_checkout(backup_dir: Path, repo: str, branch: str) -> None:
    if (backup_dir / ".git").exists():
        run(["git", "remote", "set-url", "origin", f"https://github.com/{repo}.git"], cwd=backup_dir)
        return
    backup_dir.parent.mkdir(parents=True, exist_ok=True)
    if backup_dir.exists() and any(backup_dir.iterdir()):
        raise SystemExit(f"Backup directory exists and is not a git repo: {backup_dir}")
    result = subprocess.run(["git", "clone", f"https://github.com/{repo}.git", str(backup_dir)])
    if result.returncode == 0:
        return
    backup_dir.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-b", branch], cwd=backup_dir)
    run(["git", "remote", "add", "origin", f"https://github.com/{repo}.git"], cwd=backup_dir)


def create_archive(archive: Path, backup_dir: Path, include_generated: bool) -> None:
    parent = ROOT.parent
    source_name = ROOT.name
    command = ["tar", "-czf", str(archive)]
    excluded = relative_exclude(parent, backup_dir)
    if excluded:
        command.extend(["--exclude", excluded])
    if not include_generated:
        for pattern in DEFAULT_EXCLUDES:
            command.extend(["--exclude", f"{source_name}/{pattern}"])
            command.extend(["--exclude", f"{source_name}/**/{pattern}"])
    command.extend(["-C", str(parent), source_name])
    env = os.environ.copy()
    env["COPYFILE_DISABLE"] = "1"
    run(command, env=env)


def relative_exclude(parent: Path, backup_dir: Path) -> str | None:
    try:
        backup_dir.relative_to(ROOT)
    except ValueError:
        return None
    return f"{ROOT.name}/{backup_dir.relative_to(ROOT).as_posix()}"


def encrypt_archive(archive: Path, encrypted: Path, password: str) -> None:
    env = os.environ.copy()
    env["OL2_BACKUP_PASSWORD"] = password
    run([
        "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "600000",
        "-in", str(archive), "-out", str(encrypted), "-pass", "env:OL2_BACKUP_PASSWORD",
    ], env=env)


def prepare_backup_worktree(backup_dir: Path, keep_history: bool, branch: str) -> None:
    if keep_history:
        clean_generated_files(backup_dir)
        return
    orphan = f"backup-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    run(["git", "checkout", "--orphan", orphan], cwd=backup_dir)
    clean_generated_files(backup_dir)
    run(["git", "branch", "-M", branch], cwd=backup_dir)


def clean_generated_files(backup_dir: Path) -> None:
    for child in backup_dir.iterdir():
        if child.name == ".git":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def split_archive(encrypted: Path, backup_dir: Path, chunk_size: int) -> list[str]:
    parts_dir = backup_dir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[str] = []
    index = 1
    with encrypted.open("rb") as source:
        while True:
            data = source.read(chunk_size)
            if not data:
                break
            name = f"parts/ol2.tar.gz.enc.part{index:04d}"
            (backup_dir / name).write_bytes(data)
            chunks.append(name)
            print(f"[backup] wrote {name} ({len(data) / (1024 * 1024):.1f} MB)")
            index += 1
    return chunks


def write_restore_files(
    backup_dir: Path,
    repo: str,
    branch: str,
    timestamp: str,
    chunks: list[str],
    chunk_size: int,
    encrypted_size: int,
    encrypted_sha: str,
    include_generated: bool,
) -> None:
    manifest = {
        "source": str(ROOT),
        "created_at_utc": timestamp,
        "repo": repo,
        "branch": branch,
        "format": "tar.gz encrypted with openssl aes-256-cbc pbkdf2",
        "openssl_iter": 600000,
        "chunk_size_bytes": chunk_size,
        "encrypted_size_bytes": encrypted_size,
        "encrypted_sha256": encrypted_sha,
        "include_generated": include_generated,
        "excluded_reinstallable_patterns": [] if include_generated else list(DEFAULT_EXCLUDES),
        "chunks": chunks,
        "restore": "python3 restore_ol2_backup.py --target ../OL2-restored",
    }
    (backup_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    restore_path = backup_dir / "restore_ol2_backup.py"
    restore_path.write_text(RESTORE_SCRIPT, encoding="utf-8")
    restore_path.chmod(0o755)
    (backup_dir / "README.md").write_text(
        "\n".join([
            "# OL2 Encrypted Backup",
            "",
            "This repo stores a password-encrypted full-folder OL2 backup.",
            "",
            "Restore:",
            "",
            "```bash",
            "python3 restore_ol2_backup.py --target ../OL2-restored",
            "```",
            "",
            "The backup includes `.env` files, nested app `.git` directories, and cloud wrapper repos.",
            "",
            "By default it excludes reinstallable/generated files such as `node_modules`, `.next`, `dist`, `build`, Flutter/Gradle caches, installers, app bundles, and logs. Run `npm run backup:ol2 -- --include-generated` only if you intentionally want those archived too.",
            "",
        ]),
        encoding="utf-8",
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def has_changes(repo: Path) -> bool:
    return subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo).returncode == 1


def run(command: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    completed = subprocess.run(command, cwd=cwd, env=env)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
