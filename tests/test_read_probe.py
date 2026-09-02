import unittest
from datetime import date

from kreta_read_probe import (
    all_nested_uids,
    all_uids,
    count_nested_objects,
    first_direct_value,
    first_nested_uid,
    first_uid,
    representative_school_window,
    response_shape,
)


class ReadProbeHelpersTest(unittest.TestCase):
    def test_response_shape_does_not_include_values(self) -> None:
        self.assertEqual(response_shape([{"Nev": "Titkos név"}]), "1 elem")
        self.assertEqual(response_shape({"Nev": "Titkos név"}), "objektum érkezett")

    def test_extracts_seed_identifiers_without_returning_other_fields(self) -> None:
        data = [{"Uid": "group-1", "Nev": "Titkos név"}]
        self.assertEqual(first_uid(data), "group-1")

        evaluations = [{"Tantargy": {"Uid": "subject-1", "Nev": "Titkos"}}]
        self.assertEqual(
            first_nested_uid(evaluations, ("Tantargy",)),
            "subject-1",
        )

    def test_missing_identifier_returns_none(self) -> None:
        self.assertIsNone(first_uid([]))
        self.assertIsNone(first_nested_uid([{"Tantargy": None}], ("Tantargy",)))

    def test_collects_unique_uids(self) -> None:
        self.assertEqual(
            all_uids([{"Uid": "one"}, {"Uid": "one"}, {"Uid": "two"}]),
            ["one", "two"],
        )

    def test_extracts_study_task_uid_prefixes(self) -> None:
        groups = [
            {"OktatasNevelesiFeladat": {"Uid": "task-1,extra"}},
            {"OktatasNevelesiFeladat": {"Uid": "task-1,other"}},
            {"OktatasNevelesiFeladat": {"Uid": "task-2"}},
        ]
        self.assertEqual(
            all_nested_uids(groups, "OktatasNevelesiFeladat"),
            ["task-1", "task-2"],
        )

    def test_counts_embedded_records_without_exposing_them(self) -> None:
        groups = [{"OsztalyFonok": {"Uid": "secret"}}, {"OsztalyFonok": None}]
        self.assertEqual(count_nested_objects(groups, "OsztalyFonok"), 1)

    def test_finds_direct_seed_value(self) -> None:
        lessons = [{"HaziFeladatUid": None}, {"HaziFeladatUid": "homework-1"}]
        self.assertEqual(
            first_direct_value(lessons, ("HaziFeladatUid",)),
            "homework-1",
        )

    def test_summer_probe_window_uses_completed_school_month(self) -> None:
        self.assertEqual(
            representative_school_window(date(2026, 8, 26)),
            (date(2026, 5, 16), date(2026, 6, 15)),
        )


if __name__ == "__main__":
    unittest.main()
