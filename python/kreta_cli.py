#!/usr/bin/env python3
"""Parancssoros, csak olvasható KRÉTA kliens a Claude skillhez (nincs MCP-szerver).

A hitelesítő adatokat ugyanúgy olvassa be, mint a kreta_mcp_server.py
(KRETA_CHILD_NAMES/... vagy egyes számú KRETA_USERNAME/...). JSON-t ír a
stdoutra. A jelszót SOSEM parancssori argumentumként várja — a hitelesítő
adatok csak a .env fájlból / valódi környezeti változókból jönnek, ezért
sosem jelennek meg egy Claude tool-hívásban vagy a beszélgetési előzményben.

A Claude skill ezt a scriptet futtatja a Bash tool-lal, pl.:
    uv run python kreta_cli.py homework --child Marci
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from typing import Any, Callable
from urllib.parse import quote

from kreta_client import KretaClient
from kreta_smoke_test import Credentials, SmokeTestError, load_all_credentials

MAX_ITEMS = 500
MAX_RANGE_DAYS = 93


class CliError(RuntimeError):
    """Felhasználónak mutatható, biztonságos hiba."""


_clients: dict[str, KretaClient] = {}


def get_client(child: str | None) -> KretaClient:
    try:
        children = load_all_credentials()
    except SmokeTestError as exc:
        raise CliError(str(exc)) from None

    if len(children) == 1:
        credentials = children[0]
    else:
        if not child or not child.strip():
            names = ", ".join(c.label for c in children)
            raise CliError(
                f"Több gyerek van beállítva ({names}) — add meg a --child kapcsolót."
            )
        matches = [c for c in children if c.label.lower() == child.strip().lower()]
        if not matches:
            names = ", ".join(c.label for c in children)
            raise CliError(
                f"Nincs ilyen néven beállított gyerek: {child!r}. Elérhető nevek: {names}."
            )
        credentials = matches[0]

    key = credentials.label or credentials.username
    if key not in _clients:
        try:
            _clients[key] = KretaClient(credentials=credentials)
        except SmokeTestError as exc:
            raise CliError(str(exc)) from None
    return _clients[key]


def _pack(data: Any, limit: int | None = None) -> dict[str, Any]:
    if isinstance(data, list):
        safe_limit = limit if limit is not None else MAX_ITEMS
        if not 1 <= safe_limit <= MAX_ITEMS:
            raise CliError(f"A --limit 1 és {MAX_ITEMS} közötti egész szám legyen.")
        items = data[:safe_limit]
        return {
            "items": items,
            "returned": len(items),
            "total": len(data),
            "truncated": len(items) < len(data),
        }
    return {"data": data}


def _date_range(
    start_date: str | None,
    end_date: str | None,
    *,
    default_start_days: int,
    default_end_days: int = 0,
) -> tuple[str, str]:
    today = date.today()
    try:
        start = (
            date.fromisoformat(start_date)
            if start_date
            else today + timedelta(days=default_start_days)
        )
        end = (
            date.fromisoformat(end_date)
            if end_date
            else today + timedelta(days=default_end_days)
        )
    except ValueError as exc:
        raise CliError("A dátum formátuma YYYY-MM-DD legyen.") from exc

    if end < start:
        raise CliError("A záró dátum nem lehet korábbi a kezdő dátumnál.")
    if (end - start).days > MAX_RANGE_DAYS:
        raise CliError(f"Legfeljebb {MAX_RANGE_DAYS} napos időszak kérhető le.")
    return start.isoformat(), end.isoformat()


def _uid(value: str, label: str) -> str:
    normalized = value.strip()
    if not normalized or len(normalized) > 200:
        raise CliError(f"Érvénytelen {label}.")
    return normalized


def _study_task_uids(groups: Any) -> list[str]:
    if not isinstance(groups, list):
        return []
    result: list[str] = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        task = group.get("OktatasNevelesiFeladat")
        if not isinstance(task, dict):
            continue
        raw_uid = task.get("Uid") or task.get("uid")
        if raw_uid is None:
            continue
        normalized = str(raw_uid).split(",", maxsplit=1)[0]
        if normalized and normalized not in result:
            result.append(normalized)
    return result


# --- parancsok ---------------------------------------------------------


def cmd_login(a: argparse.Namespace) -> dict[str, Any]:
    try:
        children = load_all_credentials()
    except SmokeTestError as exc:
        raise CliError(str(exc)) from None
    if a.child is None and len(children) > 1:
        result: dict[str, Any] = {}
        for c in children:
            try:
                result[c.label] = get_client(c.label).status()
            except (CliError, SmokeTestError) as exc:
                result[c.label] = {"authenticated": False, "error": str(exc)}
        return result
    return get_client(a.child).status()


def cmd_student_profile(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("sajat/TanuloAdatlap"))


def cmd_guardian_profile(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("sajat/GondviseloAdatlap"))


def cmd_class_groups(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("sajat/OsztalyCsoportok"), a.limit)


def cmd_evaluations(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("sajat/Ertekelesek"), a.limit)


def cmd_absences(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("sajat/Mulasztasok"), a.limit)


def cmd_notes(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("sajat/Feljegyzesek"), a.limit)


def cmd_announcements(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("sajat/FaliujsagElemek"), a.limit)


def cmd_timetable(a: argparse.Namespace) -> dict[str, Any]:
    start, end = _date_range(a.start_date, a.end_date, default_start_days=-7, default_end_days=7)
    data = get_client(a.child).get_json("sajat/OrarendElemek", {"datumTol": start, "datumIg": end})
    return _pack(data, a.limit)


def cmd_timetable_item(a: argparse.Namespace) -> dict[str, Any]:
    uid = _uid(a.uid, "órarendi UID")
    return _pack(get_client(a.child).get_json("sajat/OrarendElem", {"orarendElemUid": uid}))


def cmd_homework(a: argparse.Namespace) -> dict[str, Any]:
    start, end = _date_range(a.start_date, a.end_date, default_start_days=-30, default_end_days=14)
    data = get_client(a.child).get_json("sajat/HaziFeladatok", {"datumTol": start, "datumIg": end})
    return _pack(data, a.limit)


def cmd_homework_detail(a: argparse.Namespace) -> dict[str, Any]:
    uid = _uid(a.uid, "házi feladat UID")
    return _pack(get_client(a.child).get_json(f"sajat/HaziFeladatok/{quote(uid, safe='')}"))


def cmd_announced_tests(a: argparse.Namespace) -> dict[str, Any]:
    start, end = _date_range(a.start_date, a.end_date, default_start_days=-7, default_end_days=30)
    data = get_client(a.child).get_json(
        "sajat/BejelentettSzamonkeresek", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, a.limit)


def cmd_consulting_hours(a: argparse.Namespace) -> dict[str, Any]:
    start, end = _date_range(a.start_date, a.end_date, default_start_days=0, default_end_days=60)
    data = get_client(a.child).get_json("sajat/Fogadoorak", {"datumTol": start, "datumIg": end})
    return _pack(data, a.limit)


def cmd_consulting_hour_detail(a: argparse.Namespace) -> dict[str, Any]:
    uid = _uid(a.uid, "fogadóóra UID")
    return _pack(get_client(a.child).get_json(f"sajat/Fogadoorak/{quote(uid, safe='')}"))


def cmd_school_calendar(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("sajat/Intezmenyek/TanevRendjeElemek"), a.limit)


def cmd_week_schedule(a: argparse.Namespace) -> dict[str, Any]:
    start, end = _date_range(a.start_date, a.end_date, default_start_days=-7, default_end_days=14)
    data = get_client(a.child).get_json(
        "sajat/Intezmenyek/Hetirendek/Orarendi",
        {"orarendElemKezdoNapDatuma": start, "orarendElemVegNapDatuma": end},
    )
    return _pack(data, a.limit)


def cmd_class_averages(a: argparse.Namespace) -> dict[str, Any]:
    client = get_client(a.child)
    groups = client.get_json("sajat/OsztalyCsoportok")
    all_averages: list[Any] = []
    for study_task_uid in _study_task_uids(groups):
        data = client.get_json(
            "sajat/Ertekelesek/Atlagok/OsztalyAtlagok",
            [
                ("oktatasiNevelesiFeladatUid", study_task_uid),
                ("oktatasiNevelesiFeladatUid", study_task_uid),
            ],
        )
        if isinstance(data, list):
            all_averages.extend(data)
        elif data is not None:
            all_averages.append(data)
    return _pack(all_averages, a.limit)


def cmd_device_status(a: argparse.Namespace) -> dict[str, Any]:
    client = get_client(a.child)
    return {
        "assigned": client.get_json("TargyiEszkoz/IsEszkozKiosztva"),
        "registered": client.get_json("TargyiEszkoz/IsRegisztralt"),
    }


def cmd_lazar_ervin_events(a: argparse.Namespace) -> dict[str, Any]:
    return _pack(get_client(a.child).get_json("Lep/Eloadasok"), a.limit)


# --- CLI-váz -------------------------------------------------------------

_COMMANDS: dict[str, tuple[str, Callable[[argparse.Namespace], Any], bool, bool]] = {
    # név: (leírás, handler, dátumtartomány kell-e, uid kell-e)
    "login": ("Belépés ellenőrzése (gyerek nélkül: mindegyik, ha több van).", cmd_login, False, False),
    "student-profile": ("Tanuló adatlapja.", cmd_student_profile, False, False),
    "guardian-profile": ("Gondviselői adatlap.", cmd_guardian_profile, False, False),
    "class-groups": ("Osztályok és csoportok.", cmd_class_groups, False, False),
    "evaluations": ("Jegyek és értékelések.", cmd_evaluations, False, False),
    "absences": ("Mulasztások.", cmd_absences, False, False),
    "notes": ("Feljegyzések.", cmd_notes, False, False),
    "announcements": ("Faliújság.", cmd_announcements, False, False),
    "timetable": ("Órarend (alapból ±7 nap).", cmd_timetable, True, False),
    "timetable-item": ("Egy órarendi elem részletei.", cmd_timetable_item, False, True),
    "homework": ("Házi feladatok (alapból -30/+14 nap).", cmd_homework, True, False),
    "homework-detail": ("Egy házi feladat részletei.", cmd_homework_detail, False, True),
    "announced-tests": ("Bejelentett dolgozatok (alapból -7/+30 nap).", cmd_announced_tests, True, False),
    "consulting-hours": ("Fogadóórák (alapból +60 nap).", cmd_consulting_hours, True, False),
    "consulting-hour-detail": ("Egy fogadóóra részletei.", cmd_consulting_hour_detail, False, True),
    "school-calendar": ("Tanév rendje.", cmd_school_calendar, False, False),
    "week-schedule": ("Intézményi hetirend (alapból -7/+14 nap).", cmd_week_schedule, True, False),
    "class-averages": ("Osztályátlagok.", cmd_class_averages, False, False),
    "device-status": ("Eszközállapot.", cmd_device_status, False, False),
    "lazar-ervin-events": ("Lázár Ervin Program előadásai.", cmd_lazar_ervin_events, False, False),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="kreta_cli.py",
        description="Csak olvasható KRÉTA lekérdezések JSON kimenettel.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name, (help_text, _fn, needs_range, needs_uid) in _COMMANDS.items():
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--child", help="Melyik gyerekről legyen szó (ha több van beállítva).")
        if name not in ("timetable-item", "homework-detail", "consulting-hour-detail", "login", "guardian-profile", "student-profile", "device-status"):
            p.add_argument("--limit", type=int, default=100, help="Legfeljebb ennyi elem (max 500).")
        if needs_range:
            p.add_argument("--start-date", help="YYYY-MM-DD")
            p.add_argument("--end-date", help="YYYY-MM-DD")
        if needs_uid:
            p.add_argument("--uid", required=True, help="A listaválaszból kapott azonosító.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _help_text, handler, _needs_range, _needs_uid = _COMMANDS[args.command]
    try:
        result = handler(args)
    except (CliError, SmokeTestError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
