from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("release_pipeline.py")
SPEC = importlib.util.spec_from_file_location("leash_release_pipeline", SCRIPT)
assert SPEC and SPEC.loader
PIPELINE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PIPELINE
SPEC.loader.exec_module(PIPELINE)


class ReleasePipelineTests(unittest.TestCase):
    def test_interactive_menu_builds_safe_plan_arguments(self):
        versions = {
            "client-api": "0.37.3",
            "cloud-client-api": "0.1.15",
            "desktop-client": "0.37.5",
            "main-web": "0.2.12",
        }
        answers = iter(["2,4", "", "", "", "", "1"])
        with patch.object(
            PIPELINE,
            "component_version",
            side_effect=lambda component: versions.get(component.key, "0.1.0"),
        ), contextlib.redirect_stdout(io.StringIO()):
            arguments = PIPELINE.interactive_release_arguments(lambda _prompt: next(answers))
        self.assertIn("client-api=0.37.4", arguments)
        self.assertIn("cloud-client-api=0.1.16", arguments)
        self.assertIn("--desktop-channel", arguments)
        self.assertIn("terminal", arguments)
        self.assertIn("--dry-run", arguments)
        self.assertNotIn("--ship", arguments)

    def test_interactive_menu_requires_release_confirmation(self):
        answers = iter(["6", "", "2", "not release"])
        with patch.object(PIPELINE, "component_version", return_value="0.2.12"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(SystemExit, "cancelled"):
                PIPELINE.interactive_release_arguments(lambda _prompt: next(answers))

    def test_interactive_resume_can_show_saved_plan_without_shipping(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "production-test.json"
            state.write_text(json.dumps({"versions": {"desktop-client": "1.2.3"}}))
            answers = iter(["1", "1"])
            with contextlib.redirect_stdout(io.StringIO()):
                arguments = PIPELINE.interactive_resume_arguments([state], lambda _prompt: next(answers))
            self.assertEqual(arguments, ["--resume", str(state), "--dry-run"])

    def test_client_api_release_cascades_to_desktop_and_live_web(self):
        with patch.object(PIPELINE, "component_version", return_value="0.37.0"):
            selected = PIPELINE.add_required_surfaces({"client-api": "0.38.0"})
        self.assertEqual(selected["client-api"], "0.38.0")
        self.assertIn("desktop-client", selected)
        self.assertIn("main-web", selected)

    def test_desktop_release_cascades_to_main_web(self):
        with patch.object(PIPELINE, "component_version", return_value="0.37.0"):
            selected = PIPELINE.add_required_surfaces({"desktop-client": "0.38.0"})
        self.assertIn("main-web", selected)

    def test_explicit_component_versions_are_independent(self):
        selected = PIPELINE.parse_selection(
            ["client-api=1.2.3", "cloud-client-api=4.5.6"],
            None,
        )
        self.assertEqual(
            selected,
            {"client-api": "1.2.3", "cloud-client-api": "4.5.6"},
        )

    def test_semver_comparison_uses_numeric_components(self):
        self.assertGreater(
            PIPELINE.semver_core("0.10.0"),
            PIPELINE.semver_core("0.9.99"),
        )

    def test_production_versions_must_be_stable(self):
        PIPELINE.validate_version("1.2.3")
        with self.assertRaises(SystemExit):
            PIPELINE.validate_version("1.2.3-beta.1")

    def test_client_api_pin_replacement_handles_shell_and_typescript_literals(self):
        digest = "sha256:" + "a" * 64
        value = f"0.38.0@{digest}"
        source = "\n".join([
            "image: ghcr.io/open-leash/client-api:${OPENLEASH_VERSION:-0.1.0@sha256:" + "b" * 64 + "}",
            "image: \\${OPENLEASH_IMAGE_REGISTRY:-ghcr.io/open-leash}/client-api:\\${OPENLEASH_VERSION:-0.1.0@sha256:" + "b" * 64 + "}",
        ])
        updated = PIPELINE.replace_client_api_pin_text(source, value)
        self.assertIn(f"client-api:${{OPENLEASH_VERSION:-{value}}}", updated)
        self.assertIn(f"client-api:\\${{OPENLEASH_VERSION:-{value}}}", updated)
        self.assertNotIn("0.1.0", updated)

    def test_dry_run_is_a_complete_non_mutating_plan(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch.object(PIPELINE, "component_version", return_value="0.37.0"):
            result = PIPELINE.main([
                "--app", "desktop-client=0.38.0",
                "--dry-run",
                "--yes",
            ])
        self.assertEqual(result, 0)
        rendered = output.getvalue()
        self.assertIn("desktop-client: prepare -> test/build -> commit -> push -> publish/deploy -> verify", rendered)
        self.assertIn("main-web: prepare -> test/build -> commit -> push -> publish/deploy -> verify", rendered)
        self.assertIn("live main-web install.sh", rendered)

    def test_journal_only_marks_a_successful_stage_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "release.json"
            journal = PIPELINE.Journal(state, {"completed": [], "outputs": {}}, dry_run=False)
            with self.assertRaises(RuntimeError):
                journal.run("fails", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
            self.assertNotIn("fails", journal.completed)
            self.assertEqual(journal.run("works", lambda: {"ok": True}), {"ok": True})
            self.assertIn("works", journal.completed)
            self.assertEqual(journal.run("works", lambda: self.fail("must not rerun")), {"ok": True})

    def test_resume_preserves_release_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "release.json"
            state.write_text(json.dumps({
                "versions": {"cloud-client-api": "4.5.6", "desktop-client": "1.2.3"},
                "explicit_components": ["cloud-client-api", "desktop-client"],
                "desktop_channel": "stable",
                "config": {
                    "cloud_source_only": True,
                    "cloud_api_url": "https://cloud.example.test",
                    "main_web_url": "https://web.example.test",
                    "migration_target": "custom",
                    "rollout": 25,
                },
                "completed": [],
                "outputs": {},
            }))
            output = io.StringIO()
            with contextlib.redirect_stdout(output), patch.object(PIPELINE, "component_version", return_value="0.1.0"):
                result = PIPELINE.main(["--resume", str(state), "--dry-run"])
            self.assertEqual(result, 0)
            rendered = output.getvalue()
            self.assertIn("desktop channel: stable", rendered)
            self.assertIn("cloud migrations: source only", rendered)

    def test_migrations_are_append_only_against_origin_main(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            migrations = repo / "infra/postgres/migrations"
            migrations.mkdir(parents=True)
            first = migrations / "0001_initial.sql"
            first.write_text("select 1;\n")
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            subprocess.run(["git", "config", "user.email", "release@example.test"], cwd=repo, check=True)
            subprocess.run(["git", "config", "user.name", "Release Test"], cwd=repo, check=True)
            subprocess.run(["git", "add", "."], cwd=repo, check=True)
            subprocess.run(["git", "commit", "-qm", "initial"], cwd=repo, check=True)
            subprocess.run(["git", "update-ref", "refs/remotes/origin/main", "HEAD"], cwd=repo, check=True)

            (migrations / "0002_next.sql").write_text("select 2;\n")
            PIPELINE.validate_append_only_migrations(repo, Path("infra/postgres/migrations"))

            first.write_text("select 99;\n")
            with self.assertRaisesRegex(RuntimeError, "append-only"):
                PIPELINE.validate_append_only_migrations(repo, Path("infra/postgres/migrations"))

    def test_cloud_health_must_report_the_released_version(self):
        with patch.object(PIPELINE, "fetch_json", return_value={
            "ok": True,
            "service": "openleash-cloud-client-api",
            "version": "1.2.3",
        }):
            payload = PIPELINE.verify_json_health(
                "https://api.example.test/cloud/health",
                "openleash-cloud-client-api",
                expected_version="1.2.3",
            )
            self.assertEqual(payload["version"], "1.2.3")
            with self.assertRaisesRegex(RuntimeError, "expected newly released"):
                PIPELINE.verify_json_health(
                    "https://api.example.test/cloud/health",
                    "openleash-cloud-client-api",
                    expected_version="1.2.4",
                )

    def test_terminal_release_does_not_publish_an_unbuilt_windows_link(self):
        commands = []
        args = SimpleNamespace(desktop_channel="terminal")
        with patch.object(PIPELINE, "bump_component_version"), patch.object(
            PIPELINE,
            "run_command",
            side_effect=lambda command, _cwd: commands.append(command),
        ):
            PIPELINE.prepare_component(
                PIPELINE.COMPONENTS["desktop-client"],
                "1.2.3",
                {},
                {"desktop-client": "1.2.3"},
                args,
            )
        self.assertIn("--terminal-installer", commands[0])
        self.assertNotIn("--include-windows", commands[0])


if __name__ == "__main__":
    unittest.main()
