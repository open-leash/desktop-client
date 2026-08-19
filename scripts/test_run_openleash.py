from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("run-openleash.py")
SPEC = importlib.util.spec_from_file_location("leash_runner", SCRIPT)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)


class RunnerTests(unittest.TestCase):
    def test_only_personal_modes_are_exposed(self):
        self.assertEqual(set(RUNNER.build_modes()), {"individual-open-source", "public-cloud"})

    def test_personal_mode_has_no_dashboard_identity_or_feature_containers(self):
        commands = RUNNER.startup_commands(RUNNER.build_modes()["individual-open-source"], False, False)
        rendered = "\n".join(" ".join(command.args) for command in commands)
        self.assertNotIn("dashboard", rendered)
        self.assertNotIn("IdentityLoader", rendered)
        self.assertNotIn("plugin-gateway", rendered)
        self.assertIn("feature-runtime.test.ts", rendered)

    def test_cleanup_dry_run_does_not_mutate(self):
        with patch.object(sys, "argv", ["run.py", "--clean", "--dry-run", "--yes"]), patch.object(RUNNER, "cleanup_local_leash") as cleanup:
            self.assertEqual(RUNNER.main(), 0)
        cleanup.assert_not_called()

    def test_aliases_resolve_to_personal_modes(self):
        self.assertEqual(RUNNER.normalize_mode("personal-open-source"), "individual-open-source")
        self.assertEqual(RUNNER.normalize_mode("leash-cloud"), "public-cloud")

    def test_menu_exposes_cleanup_choice(self):
        with patch("builtins.input", return_value="c"):
            self.assertEqual(RUNNER.choose_mode(), "cleanup")

    def test_menu_exposes_latest_local_release_choice(self):
        with patch("builtins.input", return_value="3"):
            self.assertEqual(RUNNER.choose_mode(), "local-release")

    def test_menu_exposes_packaged_local_cloud_choice(self):
        with patch("builtins.input", return_value="4"):
            self.assertEqual(RUNNER.choose_mode(), "local-cloud-release")

    def test_latest_local_release_preserves_existing_setup(self):
        with (
            patch.object(sys, "argv", ["run.py"]),
            patch("builtins.input", return_value="3"),
            patch.object(RUNNER, "launch_packaged_desktop", return_value=0) as launch,
        ):
            self.assertEqual(RUNNER.main(), 0)
        launch.assert_called_once_with(
            None,
            False,
            disable_updates=True,
            fresh_install=False,
            preserve_settings=True,
            rebuild=True,
        )

    def test_packaged_local_cloud_choice_runs_the_release_stack(self):
        with (
            patch.object(sys, "argv", ["run.py"]),
            patch("builtins.input", return_value="4"),
            patch.object(RUNNER, "run_packaged_local_cloud", return_value=0) as run,
        ):
            self.assertEqual(RUNNER.main(), 0)
        run.assert_called_once()

    def test_packaged_local_cloud_mode_uses_real_oauth_and_no_dev_desktop(self):
        mode = RUNNER.build_packaged_local_cloud_mode()
        self.assertNotIn("desktop-client", {process.name for process in mode.processes})
        client_api = next(process for process in mode.processes if process.name == "client-api")
        self.assertEqual(client_api.env["OPENLEASH_MOBILE_DEV_AUTH"], "0")
        main_web = next(process for process in mode.processes if process.name == "main-web")
        self.assertEqual(main_web.env["NEXT_PUBLIC_DASHBOARD_URL"], "http://localhost:9302")

    def test_local_env_only_passes_oauth_credentials_to_public_processes(self):
        with (
            patch.dict(RUNNER.os.environ, {}, clear=True),
            patch.object(RUNNER, "root_env", return_value={
                "OPENLEASH_GOOGLE_CLIENT_ID": "google-client",
                "OPENAI_ADMIN_API_KEY": "must-not-leak",
            }),
        ):
            environment = RUNNER.merged_env()
        self.assertEqual(environment["OPENLEASH_GOOGLE_CLIENT_ID"], "google-client")
        self.assertNotIn("OPENAI_ADMIN_API_KEY", environment)

    def test_packaged_desktop_dry_run_opens_release_bundle_without_development_services(self):
        packaged_app = Path("/tmp/Leash.app")
        with (
            patch.object(RUNNER, "packaged_desktop_candidates", return_value=[packaged_app]),
            patch.object(Path, "exists", return_value=True),
            patch.object(RUNNER.subprocess, "run") as run,
        ):
            self.assertEqual(RUNNER.launch_packaged_desktop(None, dry_run=True), 0)
        run.assert_not_called()

    def test_packaged_desktop_command_uses_macos_bundle_launcher(self):
        with patch.object(RUNNER.sys, "platform", "darwin"):
            self.assertEqual(
                RUNNER.packaged_desktop_command(Path("/release/personal/mac-arm64/Leash.app")),
                [
                    "launchctl", "submit", "-l", "com.openleash.local-release-launch", "--",
                    "/usr/bin/env", "-u", "ELECTRON_RUN_AS_NODE",
                    "/release/personal/mac-arm64/Leash.app/Contents/MacOS/Leash",
                    "--show-window",
                ],
            )

    def test_local_release_launch_is_clean_and_disables_updates_for_exact_bundle(self):
        with patch.object(RUNNER.sys, "platform", "darwin"):
            self.assertEqual(
                RUNNER.packaged_desktop_command(
                    Path("/release/personal/mac-arm64/Leash.app"),
                    disable_updates=True,
                    fresh_install=True,
                ),
                [
                    "launchctl", "submit", "-l", "com.openleash.local-release-launch", "--",
                    "/usr/bin/env", "-u", "ELECTRON_RUN_AS_NODE",
                    "/release/personal/mac-arm64/Leash.app/Contents/MacOS/Leash",
                    "--show-window", "--update-mode", "disabled", "--fresh-install",
                ],
            )

    def test_packaged_local_cloud_command_targets_local_api_and_keeps_settings(self):
        with patch.object(RUNNER.sys, "platform", "darwin"):
            command = RUNNER.packaged_desktop_command(
                Path("/release/personal/mac-arm64/Leash.app"),
                disable_updates=True,
                preserve_settings=True,
                remote_api_url="http://127.0.0.1:9318",
                user_data_dir=Path("/tmp/leash-local-cloud"),
            )
        self.assertIn("OPENLEASH_CLOUD_API_URL=http://127.0.0.1:9318", command)
        self.assertIn("--keep-settings", command)
        self.assertIn("--remote-api-url", command)
        self.assertEqual(command[command.index("--remote-api-url") + 1], "http://127.0.0.1:9318")
        self.assertIn("--user-data-dir=/tmp/leash-local-cloud", command)

    def test_local_release_cleans_state_and_waits_for_health(self):
        packaged_app = Path("/release/personal/mac-arm64/Leash.app")
        with (
            patch.object(RUNNER.sys, "platform", "darwin"),
            patch.object(Path, "exists", return_value=True),
            patch.object(RUNNER, "cleanup_local_leash") as cleanup,
            patch.object(RUNNER, "stop_packaged_desktop_process"),
            patch.object(RUNNER, "packaged_desktop_is_ready", return_value=True),
            patch.object(RUNNER.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)),
        ):
            self.assertEqual(
                RUNNER.launch_packaged_desktop(
                    packaged_app,
                    disable_updates=True,
                    fresh_install=True,
                ),
                0,
            )
        cleanup.assert_called_once_with(remove_data=True)

    def test_explicit_packaged_desktop_flag_skips_development_stack(self):
        with (
            patch.object(sys, "argv", ["run.py", "--packaged-desktop"]),
            patch.object(RUNNER, "launch_packaged_desktop", return_value=0) as launch,
            patch.object(RUNNER, "build_modes") as build_modes,
        ):
            self.assertEqual(RUNNER.main(), 0)
        launch.assert_called_once_with(None, False)
        build_modes.assert_not_called()

    def test_menu_cleanup_requires_confirmation_and_removes_local_data(self):
        with (
            patch.object(sys, "argv", ["run.py"]),
            patch("builtins.input", side_effect=["c", "y"]),
            patch.object(RUNNER, "cleanup_local_leash") as cleanup,
        ):
            self.assertEqual(RUNNER.main(), 0)
        cleanup.assert_called_once_with(remove_data=True)

    def test_full_cleanup_covers_current_and_legacy_client_state(self):
        targets = {str(path) for path in RUNNER.local_state_paths()}
        self.assertTrue(any(path.endswith("/Application Support/Leash") for path in targets))
        self.assertTrue(any(path.endswith("/Application Support/OpenLeash") for path in targets))
        self.assertIn("/Applications/Leash.app", targets)
        self.assertIn("/Applications/OpenLeash.app", targets)
        self.assertIn("/usr/local/bin/openleash", targets)
        self.assertIn("/opt/homebrew/bin/leash", targets)
        self.assertTrue(any(path.endswith("/apps/desktop-client/.dev/OpenLeash.app") for path in targets))
        self.assertIn(str(RUNNER.PACKAGED_LOCAL_CLOUD_USER_DATA), targets)

    def test_full_cleanup_stops_packaged_local_cloud_services(self):
        with (
            patch.object(RUNNER, "stop_dev_processes"),
            patch.object(RUNNER, "stop_listeners_on_ports") as stop_listeners,
            patch.object(RUNNER, "stop_installed_app_processes"),
            patch.object(RUNNER, "cleanup_installed_app_integrations"),
            patch.object(RUNNER, "remove_macos_registrations"),
            patch.object(RUNNER, "discover_local_leash_containers", return_value=[]),
            patch.object(RUNNER, "discover_local_leash_volumes", return_value=[]),
            patch.object(RUNNER, "discover_local_leash_networks", return_value=[]),
            patch.object(RUNNER, "discover_local_leash_image_ids", return_value=[]),
            patch.object(RUNNER, "local_state_paths", return_value=()),
            patch.object(RUNNER.subprocess, "run"),
        ):
            RUNNER.cleanup_local_leash(remove_data=True)

        stop_listeners.assert_called_once_with(RUNNER.LOCAL_LEASH_SERVICE_PORTS)

    def test_full_cleanup_recognizes_all_leash_images(self):
        self.assertTrue(RUNNER.is_local_leash_image_repository("ghcr.io/open-leash/client-api"))
        self.assertTrue(RUNNER.is_local_leash_image_repository("openleash/plugin-rules-enforcer"))
        self.assertTrue(RUNNER.is_local_leash_image_repository("openleash-local-proxy"))
        self.assertTrue(RUNNER.is_local_leash_image_repository("leash-client-api"))
        self.assertFalse(RUNNER.is_local_leash_image_repository("postgres"))

    def test_packaged_integration_cleanup_failure_does_not_abort_full_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "Leash"
            executable.touch()
            failed = subprocess.CompletedProcess([], -5, stderr="Electron trapped")
            with patch.object(RUNNER.subprocess, "run", return_value=failed) as run:
                RUNNER.cleanup_installed_app_integrations((executable,))

        command = run.call_args.args[0]
        self.assertEqual(command[0], str(executable))
        self.assertTrue(command[1].startswith("--user-data-dir="))
        self.assertEqual(command[2], "--cleanup-integrations")
        self.assertFalse(run.call_args.kwargs["check"])
        self.assertEqual(run.call_args.kwargs["timeout"], 15)

    def test_cleanup_removes_installer_and_local_release_launch_jobs(self):
        not_running = subprocess.CompletedProcess([], 1)
        with (
            patch.object(RUNNER.sys, "platform", "darwin"),
            patch.object(RUNNER.subprocess, "run", return_value=not_running) as run,
        ):
            RUNNER.stop_installed_app_processes()

        commands = [call.args[0] for call in run.call_args_list]
        self.assertIn(
            ["launchctl", "remove", "com.openleash.installer-launch"],
            commands,
        )
        self.assertIn(
            ["launchctl", "remove", "com.openleash.local-release-launch"],
            commands,
        )

    def test_cleanup_discovers_and_removes_stale_submitted_launch_job(self):
        launchctl_list = subprocess.CompletedProcess(
            [],
            0,
            stdout=(
                "PID\tStatus\tLabel\n"
                "431\t0\tcom.openleash.test-launch\n"
                "-\t0\tcom.apple.unrelated\n"
            ),
        )
        not_running = subprocess.CompletedProcess([], 1)

        def run(command, **_kwargs):
            if command == ["launchctl", "list"]:
                return launchctl_list
            return not_running

        with (
            patch.object(RUNNER.sys, "platform", "darwin"),
            patch.object(RUNNER.subprocess, "run", side_effect=run) as subprocess_run,
        ):
            RUNNER.stop_installed_app_processes()

        commands = [call.args[0] for call in subprocess_run.call_args_list]
        self.assertIn(
            ["launchctl", "remove", "com.openleash.test-launch"],
            commands,
        )

    def test_launchctl_parser_only_targets_leash_jobs(self):
        output = """
431 0 com.openleash.test-launch
- 1 com.leash.background
92 0 com.apple.Safari
"""
        self.assertEqual(
            RUNNER.parse_leash_launchctl_labels(output),
            ["com.leash.background", "com.openleash.test-launch"],
        )

    def test_launch_services_parser_targets_leash_apps_and_stale_volumes(self):
        dump = """
path: /Applications/Leash.app (0x123)
path: /tmp/OpenLeash Helper.app (0x124)
path: /Applications/Other.app (0x125)
path: /Volumes/OpenLeash 2 (0x126)
"""
        self.assertEqual(
            [str(path) for path in RUNNER.parse_registered_leash_app_paths(dump)],
            ["/Applications/Leash.app", "/Volumes/OpenLeash 2", "/tmp/OpenLeash Helper.app"],
        )

if __name__ == "__main__":
    unittest.main()
