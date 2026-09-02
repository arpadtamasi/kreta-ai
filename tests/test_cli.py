from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

import kreta_cli as cli
from kreta_smoke_test import Credentials


class FakeClient:
    def __init__(self, responses: dict[str, object] | None = None) -> None:
        self.responses = responses or {}
        self.calls: list[tuple[str, object]] = []

    def status(self) -> dict[str, object]:
        return {"authenticated": True, "read_only": True}

    def get_json(self, path: str, params: object = None) -> object:
        self.calls.append((path, params))
        return self.responses.get(path, [])


class GetClientChildResolutionTest(unittest.TestCase):
    def setUp(self) -> None:
        cli._clients = {}
        self.addCleanup(lambda: setattr(cli, "_clients", {}))

    def _children(self, *labels: str) -> list[Credentials]:
        return [
            Credentials(username=f"u-{label}", password="p", institute_code="i", label=label)
            for label in labels
        ]

    def test_single_child_needs_no_child_argument(self) -> None:
        with patch("kreta_cli.load_all_credentials", return_value=self._children("Marci")):
            client = cli.get_client(None)
        self.assertIn("Marci", cli._clients)
        with patch("kreta_cli.load_all_credentials", return_value=self._children("Marci")):
            self.assertIs(cli.get_client(None), client)

    def test_multi_child_without_child_argument_lists_available_names(self) -> None:
        with patch("kreta_cli.load_all_credentials", return_value=self._children("Marci", "Benedek")):
            with self.assertRaisesRegex(cli.CliError, "Marci, Benedek"):
                cli.get_client(None)

    def test_multi_child_with_unknown_name_lists_available_names(self) -> None:
        with patch("kreta_cli.load_all_credentials", return_value=self._children("Marci", "Benedek")):
            with self.assertRaisesRegex(cli.CliError, "Marci, Benedek"):
                cli.get_client("Someone Else")

    def test_multi_child_resolves_by_name_case_insensitively(self) -> None:
        with patch("kreta_cli.load_all_credentials", return_value=self._children("Marci", "Benedek")):
            client = cli.get_client("marci")
        self.assertIn("Marci", cli._clients)
        self.assertNotIn("Benedek", cli._clients)


class CliHelpersTest(unittest.TestCase):
    def test_pack_limits_lists_without_losing_total(self) -> None:
        result = cli._pack([1, 2, 3], 2)
        self.assertEqual(result["items"], [1, 2])
        self.assertEqual(result["total"], 3)
        self.assertTrue(result["truncated"])

    def test_invalid_date_order_is_rejected(self) -> None:
        with self.assertRaisesRegex(cli.CliError, "záró dátum"):
            cli._date_range("2026-08-20", "2026-08-19", default_start_days=0)

    def test_study_task_uids_are_deduplicated_and_split(self) -> None:
        groups = [
            {"OktatasNevelesiFeladat": {"Uid": "first,extra"}},
            {"OktatasNevelesiFeladat": {"Uid": "first"}},
            {"OktatasNevelesiFeladat": {"Uid": "second"}},
        ]
        self.assertEqual(cli._study_task_uids(groups), ["first", "second"])


class MainEntrypointTest(unittest.TestCase):
    def test_homework_command_prints_json_to_stdout(self) -> None:
        fake = FakeClient({"sajat/HaziFeladatok": [{"Uid": "hw1"}]})
        with patch("kreta_cli.get_client", return_value=fake):
            out = io.StringIO()
            with redirect_stdout(out):
                exit_code = cli.main(["homework"])
        self.assertEqual(exit_code, 0)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload["total"], 1)

    def test_cli_error_goes_to_stderr_with_nonzero_exit(self) -> None:
        with patch("kreta_cli.get_client", side_effect=cli.CliError("teszt hiba")):
            err = io.StringIO()
            with redirect_stderr(err):
                exit_code = cli.main(["homework"])
        self.assertEqual(exit_code, 1)
        self.assertIn("teszt hiba", json.loads(err.getvalue())["error"])

    def test_password_is_not_an_accepted_cli_argument(self) -> None:
        # Biztonsági invariáns: a jelszó SOSE lehet parancssori kapcsoló,
        # különben belekerülhetne egy Claude tool-hívásba / előzménybe.
        parser = cli.build_parser()
        for action in parser._subparsers._group_actions[0].choices.values():  # type: ignore[attr-defined]
            option_strings = {opt for a in action._actions for opt in a.option_strings}
            self.assertNotIn("--password", option_strings)
            self.assertNotIn("--kreta-password", option_strings)


if __name__ == "__main__":
    unittest.main()
