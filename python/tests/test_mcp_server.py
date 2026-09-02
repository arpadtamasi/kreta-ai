from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

import kreta_mcp_server as server
from kreta_smoke_test import Credentials
from mcp.server.mcpserver.exceptions import ToolError


class FakeClient:
    def __init__(self, responses: dict[str, object] | None = None) -> None:
        self.responses = responses or {}
        self.calls: list[tuple[str, object]] = []

    def status(self) -> dict[str, object]:
        return {"authenticated": True, "read_only": True}

    def get_json(self, path: str, params: object = None) -> object:
        self.calls.append((path, params))
        return self.responses.get(path, [])


class McpHelpersTest(unittest.TestCase):
    def test_pack_limits_lists_without_losing_total(self) -> None:
        result = server._pack([1, 2, 3], 2)
        self.assertEqual(result["items"], [1, 2])
        self.assertEqual(result["total"], 3)
        self.assertTrue(result["truncated"])

    def test_invalid_date_order_is_rejected(self) -> None:
        with self.assertRaisesRegex(ToolError, "záró dátum"):
            server._date_range(
                "2026-08-20",
                "2026-08-19",
                default_start_days=0,
            )

    def test_date_range_is_bounded(self) -> None:
        with self.assertRaisesRegex(ToolError, "Legfeljebb"):
            server._date_range(
                "2026-01-01",
                "2026-08-01",
                default_start_days=0,
            )

    def test_default_date_range_uses_iso_dates(self) -> None:
        start, end = server._date_range(
            None, None, default_start_days=-1, default_end_days=1
        )
        self.assertEqual(
            date.fromisoformat(start).toordinal() + 2,
            date.fromisoformat(end).toordinal(),
        )

    def test_study_task_uids_are_deduplicated_and_split(self) -> None:
        groups = [
            {"OktatasNevelesiFeladat": {"Uid": "first,extra"}},
            {"OktatasNevelesiFeladat": {"Uid": "first"}},
            {"OktatasNevelesiFeladat": {"Uid": "second"}},
        ]
        self.assertEqual(server._study_task_uids(groups), ["first", "second"])

    def test_timetable_uses_only_fixed_read_endpoint(self) -> None:
        fake = FakeClient({"sajat/OrarendElemek": [{"Uid": "lesson"}]})
        with patch.object(server, "get_client", return_value=fake):
            result = server.kreta_timetable("2026-08-01", "2026-08-07", 10)

        self.assertEqual(result["total"], 1)
        self.assertEqual(fake.calls[0][0], "sajat/OrarendElemek")
        self.assertEqual(
            fake.calls[0][1],
            {"datumTol": "2026-08-01", "datumIg": "2026-08-07"},
        )

    def test_class_average_duplicates_required_query_parameter(self) -> None:
        fake = FakeClient(
            {
                "sajat/OsztalyCsoportok": [
                    {"OktatasNevelesiFeladat": {"Uid": "task"}}
                ],
                "sajat/Ertekelesek/Atlagok/OsztalyAtlagok": [{"Atlag": 4.5}],
            }
        )
        with patch.object(server, "get_client", return_value=fake):
            result = server.kreta_class_averages(10)

        self.assertEqual(result["total"], 1)
        self.assertEqual(
            fake.calls[1][1],
            [
                ("oktatasiNevelesiFeladatUid", "task"),
                ("oktatasiNevelesiFeladatUid", "task"),
            ],
        )


class GetClientChildResolutionTest(unittest.TestCase):
    def setUp(self) -> None:
        server._children = None
        server._clients = {}
        self.addCleanup(self._reset_globals)

    def _reset_globals(self) -> None:
        server._children = None
        server._clients = {}

    def _set_children(self, *labels: str) -> None:
        server._children = [
            Credentials(username=f"u-{label}", password="p", institute_code="i", label=label)
            for label in labels
        ]

    def test_single_child_needs_no_child_argument(self) -> None:
        self._set_children("Marci")
        client = server.get_client()
        self.assertIn("Marci", server._clients)
        self.assertIs(server.get_client(), client)  # cached, not reconstructed

    def test_multi_child_without_child_argument_lists_available_names(self) -> None:
        self._set_children("Marci", "Benedek")
        with self.assertRaisesRegex(ToolError, "Marci, Benedek"):
            server.get_client()

    def test_multi_child_with_unknown_name_lists_available_names(self) -> None:
        self._set_children("Marci", "Benedek")
        with self.assertRaisesRegex(ToolError, "Marci, Benedek"):
            server.get_client("Someone Else")

    def test_multi_child_resolves_by_name_case_insensitively(self) -> None:
        self._set_children("Marci", "Benedek")
        client = server.get_client("marci")
        self.assertIn("Marci", server._clients)
        self.assertNotIn("Benedek", server._clients)
        self.assertIs(server.get_client("MARCI"), client)  # cached, case-insensitive

    def test_login_without_child_aggregates_all_when_multiple_configured(self) -> None:
        self._set_children("Marci", "Benedek")
        with patch.object(server, "get_client", side_effect=lambda c: FakeClient()):
            result = server.kreta_login()
        self.assertEqual(set(result), {"Marci", "Benedek"})
        self.assertTrue(result["Marci"]["authenticated"])

    def test_login_with_child_targets_only_that_child(self) -> None:
        self._set_children("Marci", "Benedek")
        fake = FakeClient()
        with patch.object(server, "get_client", return_value=fake) as mock_get:
            result = server.kreta_login(child="Marci")
        mock_get.assert_called_once_with("Marci")
        self.assertTrue(result["authenticated"])


if __name__ == "__main__":
    unittest.main()
