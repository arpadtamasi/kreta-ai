from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

import kreta_mcp_server as server
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


if __name__ == "__main__":
    unittest.main()
