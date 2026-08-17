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
        self.assertIn("desktop-client=0.37.6", arguments)
        self.assertIn("main-web=0.2.13", arguments)
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
        self.assertIn("direct Google Cloud main-web deploy and live install.sh", rendered)

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

    def test_git_fetch_retries_transient_github_server_errors(self):
        failed = subprocess.CompletedProcess(
            ["git", "fetch"],
            128,
            "",
            "error: RPC failed; HTTP 500\nfatal: expected flush after ref listing\n",
        )
        passed = subprocess.CompletedProcess(["git", "fetch"], 0, "ok\n", "")
        output = io.StringIO()
        with patch.object(PIPELINE.subprocess, "run", side_effect=[failed, passed]) as run, patch.object(
            PIPELINE.time,
            "sleep",
        ) as sleep, contextlib.redirect_stderr(output):
            result = PIPELINE.git(Path.cwd(), "fetch", "origin", "main")
        self.assertEqual(result, "ok\n")
        self.assertEqual(run.call_count, 2)
        sleep.assert_called_once_with(1)
        self.assertIn("transient GitHub failure", output.getvalue())

    def test_git_does_not_retry_non_network_failures(self):
        failed = subprocess.CompletedProcess(
            ["git", "fetch"],
            128,
            "",
            "fatal: couldn't find remote ref missing\n",
        )
        with patch.object(PIPELINE.subprocess, "run", return_value=failed) as run, patch.object(
            PIPELINE.time,
            "sleep",
        ) as sleep:
            with self.assertRaises(subprocess.CalledProcessError):
                PIPELINE.git(Path.cwd(), "fetch", "origin", "missing")
        self.assertEqual(run.call_count, 1)
        sleep.assert_not_called()

    def test_check_runs_fall_back_to_graphql_when_rest_is_unavailable(self):
        rest_error = subprocess.CalledProcessError(1, ["gh", "api"], "", "HTTP 504")
        graphql_payload = json.dumps({
            "data": {
                "repository": {
                    "object": {
                        "statusCheckRollup": {
                            "contexts": {
                                "nodes": [{
                                    "name": "Build",
                                    "status": "COMPLETED",
                                    "conclusion": "SUCCESS",
                                    "checkSuite": {"app": {"name": "Google Cloud Build"}},
                                }],
                            },
                        },
                    },
                },
            },
        })
        with patch.object(PIPELINE, "capture", side_effect=[rest_error, graphql_payload]) as capture:
            checks = PIPELINE.load_check_runs("open-leash/main-web", "a" * 40)
        self.assertEqual(capture.call_count, 2)
        self.assertEqual(checks[0]["status"], "completed")
        self.assertEqual(checks[0]["conclusion"], "success")
        self.assertEqual(checks[0]["app"]["name"], "Google Cloud Build")

    def test_main_web_deploys_directly_to_google_cloud_with_an_immutable_image(self):
        commit = "a" * 40
        digest = "sha256:" + "b" * 64
        args = SimpleNamespace(
            gcp_project="cloud-test",
            gcp_region="us-central1",
            main_web_service="main-web",
        )
        service = json.dumps({
            "metadata": {"labels": {"commit-sha": commit}},
            "spec": {"template": {"spec": {"containers": [{
                "image": f"us-central1-docker.pkg.dev/cloud-test/cloud-run-source-deploy/main-web/main-web@{digest}",
            }]}}},
            "status": {
                "latestReadyRevisionName": "main-web-00001-test",
                "traffic": [{"latestRevision": True, "percent": 100}],
            },
        })
        with patch.object(PIPELINE, "run_command") as run, patch.object(
            PIPELINE,
            "capture",
            side_effect=[digest + "\n", service],
        ):
            result = PIPELINE.deploy_main_web_to_gcp(
                PIPELINE.COMPONENTS["main-web"], commit, args,
            )
        build_command, build_cwd = run.call_args_list[0].args
        deploy_command, deploy_cwd = run.call_args_list[1].args
        self.assertEqual(build_cwd, PIPELINE.COMPONENTS["main-web"].path)
        self.assertEqual(build_command[:4], ("gcloud", "builds", "submit", "."))
        self.assertIn(f"--image=us-central1-docker.pkg.dev/cloud-test/cloud-run-source-deploy/main-web/main-web@{digest}", deploy_command)
        self.assertEqual(deploy_cwd, PIPELINE.ROOT)
        self.assertEqual(result["image_digest"], digest)
        self.assertEqual(result["revision"], "main-web-00001-test")

    def test_main_web_publish_does_not_wait_for_a_github_deployment_check(self):
        args = SimpleNamespace()
        expected = {"deployed_commit": "a" * 40}
        with patch.object(PIPELINE, "deploy_main_web_to_gcp", return_value=expected) as deploy, patch.object(
            PIPELINE,
            "wait_for_checks",
        ) as wait:
            result = PIPELINE.publish_component(
                PIPELINE.COMPONENTS["main-web"], "1.2.3", "a" * 40, args,
            )
        self.assertEqual(result, expected)
        deploy.assert_called_once()
        wait.assert_not_called()

    def test_cloud_migrations_are_logged_beside_release_state(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "production-test.json"
            args = SimpleNamespace(
                migration_target="gcp",
                database_url=None,
                release_state_path=state,
            )
            with patch.object(PIPELINE, "run_command") as run:
                result = PIPELINE.run_cloud_migrations(args, "status")
            command = run.call_args.args[0]
            expected = state.parent / "migration-logs" / state.stem
            self.assertEqual(command[command.index("--log-dir") + 1], str(expected))
            self.assertEqual(result["log_dir"], str(expected))

    def test_failure_resume_command_selects_production_pipeline(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("./release.py --production --resume", source)

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

    def test_resume_reconfirms_every_component_in_the_saved_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "release.json"
            state.write_text(json.dumps({
                "versions": {"desktop-client": "1.2.3", "main-web": "2.3.4"},
                "explicit_components": ["desktop-client"],
                "completed": [],
                "outputs": {},
            }))
            captured = {}
            original_print_plan = PIPELINE.print_plan

            def capture_plan(selected, versions, args, state_path):
                captured["explicit"] = args.explicit_components
                original_print_plan(selected, versions, args, state_path)

            with contextlib.redirect_stdout(io.StringIO()), patch.object(PIPELINE, "print_plan", side_effect=capture_plan):
                self.assertEqual(PIPELINE.main(["--resume", str(state), "--dry-run"]), 0)
            self.assertEqual(captured["explicit"], {"desktop-client", "main-web"})

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

    def test_dashboard_components_are_available_in_the_programmatic_release(self):
        selected = PIPELINE.parse_selection(
            ["cloud-dashboard-api=0.1.6", "cloud-dashboard-web=0.1.5"],
            None,
        )
        self.assertEqual(selected["cloud-dashboard-api"], "0.1.6")
        self.assertEqual(selected["cloud-dashboard-web"], "0.1.5")
        self.assertLess(
            PIPELINE.ORDER.index("cloud-dashboard-api"),
            PIPELINE.ORDER.index("cloud-dashboard-web"),
        )

    def test_release_wide_tests_run_before_any_component_prepare(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertLess(
            source.index('journal.run("release-wide-tests"'),
            source.index('journal.run(f"{key}:prepare"'),
        )

    def test_cloud_postgres_gate_runs_from_public_root(self):
        component = PIPELINE.COMPONENTS["cloud-client-api"]
        self.assertEqual(
            PIPELINE.component_command_cwd(component, ("node", "scripts/test-cloud-postgres-upgrades.mjs")),
            PIPELINE.ROOT,
        )
        self.assertEqual(
            PIPELINE.component_command_cwd(component, ("npm", "test")),
            component.path,
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
