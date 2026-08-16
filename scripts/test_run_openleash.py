from __future__ import annotations

import importlib.util
import subprocess
import sys
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

    def test_latest_local_release_simulates_a_clean_install(self):
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
            fresh_install=True,
        )

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
                ["open", "-n", "/release/personal/mac-arm64/Leash.app"],
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
                    "open", "-n", "/release/personal/mac-arm64/Leash.app",
                    "--args", "--update-mode", "disabled", "--fresh-install",
                ],
            )

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

    def test_full_cleanup_recognizes_all_leash_images(self):
        self.assertTrue(RUNNER.is_local_leash_image_repository("ghcr.io/open-leash/client-api"))
        self.assertTrue(RUNNER.is_local_leash_image_repository("openleash/plugin-rules-enforcer"))
        self.assertTrue(RUNNER.is_local_leash_image_repository("openleash-local-proxy"))
        self.assertTrue(RUNNER.is_local_leash_image_repository("leash-client-api"))
        self.assertFalse(RUNNER.is_local_leash_image_repository("postgres"))

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
