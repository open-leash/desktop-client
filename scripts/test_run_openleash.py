from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("run-openleash.py")
SPEC = importlib.util.spec_from_file_location("openleash_runner", SCRIPT)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)


def completed(args: list[str], code: int, stdout: str = "", stderr: str = ""):
    return subprocess.CompletedProcess(args, code, stdout=stdout, stderr=stderr)


class DockerVolumeCleanupTests(unittest.TestCase):
    def test_stale_container_reference_recovers_and_retries_volume_removal(self):
        ghost_id = "25ec1efd4652"
        results = [
            completed(["docker", "volume", "inspect"], 0),
            completed(["docker", "ps"], 0, stdout=f"{ghost_id}\n"),
            completed(["docker", "rm"], 0, stderr="Error response from daemon: No such container"),
            completed(["docker", "container", "inspect"], 1),
            completed(["docker", "volume", "rm"], 1, stderr="volume is in use"),
            completed(["docker", "volume", "rm"], 0, stdout="ol2_openleash-postgres\n"),
        ]
        recovered: list[tuple[str, list[str]]] = []

        with patch.object(RUNNER.subprocess, "run", side_effect=results):
            RUNNER.remove_docker_volume_if_present(
                "ol2_openleash-postgres",
                recover_stale_reference=lambda name, ids: recovered.append((name, ids)) or True,
            )

        self.assertEqual(recovered, [("ol2_openleash-postgres", [ghost_id])])

    def test_stale_container_reference_fails_with_recovery_instructions(self):
        ghost_id = "25ec1efd4652"
        results = [
            completed(["docker", "volume", "inspect"], 0),
            completed(["docker", "ps"], 0, stdout=f"{ghost_id}\n"),
            completed(["docker", "rm"], 1, stderr="no such container"),
            completed(["docker", "container", "inspect"], 1),
            completed(["docker", "volume", "rm"], 1, stderr="volume is in use"),
        ]

        with patch.object(RUNNER.subprocess, "run", side_effect=results):
            with self.assertRaisesRegex(
                RuntimeError,
                "--restart-docker-desktop-on-stale-volume",
            ):
                RUNNER.remove_docker_volume_if_present(
                    "ol2_openleash-postgres",
                    recover_stale_reference=lambda _name, _ids: False,
                )

    def test_explicit_stale_recovery_restarts_docker_desktop(self):
        results = [
            completed(["docker", "ps"], 0, stdout="unrelated-postgres\n"),
            completed(["docker", "desktop", "restart"], 0),
        ]
        with patch.object(RUNNER.subprocess, "run", side_effect=results) as run:
            recovered = RUNNER.recover_stale_docker_volume_reference(
                "ol2_openleash-postgres",
                ["ghost"],
                allow_restart=True,
                prompt_for_restart=False,
            )
        self.assertTrue(recovered)
        self.assertEqual(
            run.call_args_list[-1].args[0],
            ["docker", "desktop", "restart", "--timeout", "120"],
        )


class OptionalStepTests(unittest.TestCase):
    def test_missing_working_directory_is_not_reported_as_missing_command(self):
        missing = Path("/tmp/openleash-test-missing-runtime")
        command = RUNNER.Command("missing-runtime", ["docker", "compose", "down"], cwd=missing)
        with patch.object(RUNNER.subprocess, "run") as run:
            RUNNER.run_optional_step(command)
        run.assert_not_called()


class RunnerArgumentTests(unittest.TestCase):
    def test_cleanup_dry_run_never_calls_cleanup(self):
        with (
            patch.object(sys, "argv", ["run.py", "--clean", "--yes", "--dry-run"]),
            patch.object(RUNNER, "cleanup_local_openleash_for_args") as cleanup,
        ):
            self.assertEqual(RUNNER.main(), 0)
        cleanup.assert_not_called()


if __name__ == "__main__":
    unittest.main()
