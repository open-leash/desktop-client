from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("leash_migrate", ROOT / "migrate.py")
assert SPEC and SPEC.loader
MIGRATE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MIGRATE
SPEC.loader.exec_module(MIGRATE)


class MigrationAuditTests(unittest.TestCase):
    def test_audit_header_redacts_database_password(self):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(dry_run=False, log_dir=directory, target="custom")
            audit = MIGRATE.create_migration_audit_log(
                args,
                "postgres://leash:super-secret@db.example:5432/leash",
                ["core"],
                "apply",
            )
            contents = audit.path.read_text(encoding="utf-8")
            self.assertIn("postgres://leash:****@db.example:5432/leash", contents)
            self.assertNotIn("super-secret", contents)

    def test_pending_sql_log_contains_only_confirmed_pending_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            migrations = root / "migrations"
            migrations.mkdir()
            (migrations / "001_first.sql").write_text("select 1;\n", encoding="utf-8")
            (migrations / "002_second.sql").write_text("select 2;\n", encoding="utf-8")
            log = root / "audit.log"
            log.touch()
            audit = MIGRATE.MigrationAuditLog(log)
            with patch.dict(MIGRATE.MIGRATION_DIRECTORIES, {"core": migrations}):
                MIGRATE.log_pending_migration_sql(
                    "core",
                    "applied  001_first  2026-08-17T00:00:00Z\npending  002_second  002_second.sql\n",
                    audit,
                    dry_run=False,
                )
            contents = log.read_text(encoding="utf-8")
            self.assertIn("002_second.sql", contents)
            self.assertIn("select 2;", contents)
            self.assertIn("sha256=", contents)
            self.assertNotIn("select 1;", contents)

    def test_run_step_tees_output_to_console_and_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "audit.log"
            log.touch()
            audit = MIGRATE.MigrationAuditLog(log)
            output = MIGRATE.run_step(
                MIGRATE.Step("fixture", [sys.executable, "-c", "print('migration output')"]),
                False,
                audit,
            )
            self.assertEqual(output, "migration output\n")
            self.assertIn("migration output", log.read_text(encoding="utf-8"))

    def test_run_step_raises_when_command_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "audit.log"
            log.touch()
            with self.assertRaises(subprocess.CalledProcessError):
                MIGRATE.run_step(
                    MIGRATE.Step("fixture", [sys.executable, "-c", "raise SystemExit(7)"]),
                    False,
                    MIGRATE.MigrationAuditLog(log),
                )

    def test_dry_run_does_not_create_audit_file(self):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(dry_run=True, log_dir=directory, target="custom")
            audit = MIGRATE.create_migration_audit_log(
                args,
                "postgres://leash:secret@db.example/leash",
                ["core"],
                "status",
            )
            self.assertIsNone(audit.path)
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
