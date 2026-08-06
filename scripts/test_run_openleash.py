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


if __name__ == "__main__":
    unittest.main()
