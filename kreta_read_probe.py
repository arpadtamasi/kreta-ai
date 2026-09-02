#!/usr/bin/env python3
"""Probe the documented read-only KRÉTA Student Mobile API endpoints.

No response body, token, identifier, grade, message, or personal field is
printed or persisted. Only HTTP status and aggregate response shape are shown.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

import requests

from kreta_smoke_test import (
    MOBILE_API_KEY,
    MOBILE_USER_AGENT,
    TIMEOUT_SECONDS,
    SmokeTestError,
    load_credentials,
    login,
    revoke_refresh_token,
)


@dataclass(frozen=True)
class ProbeResult:
    label: str
    state: str
    status_code: int | None
    detail: str

    def render(self) -> str:
        http = f"HTTP {self.status_code}" if self.status_code is not None else "nincs HTTP"
        return f"{self.state:<10} {self.label:<38} {http:<10} {self.detail}"


def response_shape(data: Any) -> str:
    if isinstance(data, list):
        return f"{len(data)} elem"
    if isinstance(data, dict):
        return "objektum érkezett"
    if isinstance(data, bool):
        return "logikai érték érkezett"
    if data is None:
        return "üres JSON érték"
    return f"{type(data).__name__} érték érkezett"


def first_uid(data: Any) -> str | None:
    items = data if isinstance(data, list) else [data]
    for item in items:
        if not isinstance(item, dict):
            continue
        for key in ("Uid", "uid", "Id", "id"):
            value = item.get(key)
            if value is not None and str(value):
                return str(value)
    return None


def first_nested_uid(data: Any, parent_names: tuple[str, ...]) -> str | None:
    items = data if isinstance(data, list) else [data]
    for item in items:
        if not isinstance(item, dict):
            continue
        for parent_name in parent_names:
            parent = item.get(parent_name)
            if isinstance(parent, dict):
                value = parent.get("Uid") or parent.get("uid")
                if value is not None and str(value):
                    return str(value)
    return None


def all_uids(data: Any) -> list[str]:
    if not isinstance(data, list):
        return []
    result: list[str] = []
    for item in data:
        uid = first_uid(item)
        if uid and uid not in result:
            result.append(uid)
    return result


def all_nested_uids(data: Any, parent_name: str) -> list[str]:
    if not isinstance(data, list):
        return []
    result: list[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        parent = item.get(parent_name)
        if not isinstance(parent, dict):
            continue
        value = parent.get("Uid") or parent.get("uid")
        if value is None:
            continue
        normalized = str(value).split(",", maxsplit=1)[0]
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def count_nested_objects(data: Any, parent_name: str) -> int:
    if not isinstance(data, list):
        return 0
    return sum(
        isinstance(item, dict) and isinstance(item.get(parent_name), dict)
        for item in data
    )


def first_direct_value(data: Any, keys: tuple[str, ...]) -> str | None:
    items = data if isinstance(data, list) else [data]
    for item in items:
        if not isinstance(item, dict):
            continue
        for key in keys:
            value = item.get(key)
            if value is not None and str(value):
                return str(value)
    return None


def representative_school_window(today: date) -> tuple[date, date]:
    """Return a short completed interval that does not cross a school-year edge."""
    if today.month in (7, 8):
        end = date(today.year, 6, 15)
    else:
        end = today
    return end - timedelta(days=30), end


class ReadProbe:
    def __init__(
        self,
        session: requests.Session,
        institute_code: str,
        access_token: str,
    ) -> None:
        self.session = session
        self.base_url = (
            f"https://{institute_code.lower()}.e-kreta.hu/ellenorzo/v3/"
        )
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "User-Agent": MOBILE_USER_AGENT,
            "apiKey": MOBILE_API_KEY,
            "Accept": "application/json",
        }
        self.results: list[ProbeResult] = []

    def get(
        self,
        label: str,
        path: str,
        params: Any = None,
    ) -> Any | None:
        try:
            response = self.session.get(
                self.base_url + path.lstrip("/"),
                headers=self.headers,
                params=params,
                timeout=TIMEOUT_SECONDS,
            )
        except requests.RequestException:
            self.results.append(ProbeResult(label, "HÁLÓZAT", None, "a kérés meghiúsult"))
            return None

        if not 200 <= response.status_code < 300:
            if response.status_code in (401, 403):
                state = "TILTOTT"
            elif response.status_code == 404:
                state = "NINCS"
            else:
                state = "HIBA"
            self.results.append(
                ProbeResult(label, state, response.status_code, "a törzs nincs kiírva")
            )
            return None

        if response.status_code == 204 or not response.content:
            self.results.append(ProbeResult(label, "OK", response.status_code, "üres válasz"))
            return None

        try:
            data = response.json()
        except ValueError:
            self.results.append(
                ProbeResult(label, "HIBA", response.status_code, "nem JSON válasz")
            )
            return None

        self.results.append(
            ProbeResult(label, "OK", response.status_code, response_shape(data))
        )
        return data

    def get_first_success(
        self,
        label: str,
        path: str,
        parameter_options: list[Any],
    ) -> Any | None:
        last_result: ProbeResult | None = None
        for index, params in enumerate(parameter_options, start=1):
            data = self.get(label, path, params)
            result = self.results.pop()
            if result.state == "OK":
                detail = result.detail
                if index > 1:
                    detail += f" ({index}. biztonságos paraméterezés)"
                self.results.append(
                    ProbeResult(label, result.state, result.status_code, detail)
                )
                return data
            last_result = result

        if last_result is not None:
            self.results.append(
                ProbeResult(
                    label,
                    last_result.state,
                    last_result.status_code,
                    f"{len(parameter_options)} paraméterezés sem működött",
                )
            )
        return None

    def skip(self, label: str, reason: str) -> None:
        self.results.append(ProbeResult(label, "KIHAGYVA", None, reason))

    def local_ok(self, label: str, detail: str) -> None:
        self.results.append(ProbeResult(label, "OK", None, detail))


def main() -> int:
    session = requests.Session()
    token: dict[str, str] | None = None
    try:
        credentials = load_credentials()
        print("KRÉTA bejelentkezés…", flush=True)
        token = login(session, credentials)
        probe = ReadProbe(session, credentials.institute_code, token["access_token"])

        today = date.today()
        range_start, range_end = representative_school_window(today)
        range_params = {
            "datumTol": range_start.isoformat(),
            "datumIg": range_end.isoformat(),
        }
        school_week_params = {
            "datumTol": range_start.isoformat(),
            "datumIg": (range_start + timedelta(days=7)).isoformat(),
        }

        probe.get("Tanuló adatlap (kontroll)", "sajat/TanuloAdatlap")

        groups = probe.get("Osztály/csoportok", "sajat/OsztalyCsoportok")
        group_uids = all_uids(groups)
        study_task_uids = all_nested_uids(groups, "OktatasNevelesiFeladat")

        probe.get("Értékelések", "sajat/Ertekelesek")

        consulting_hours = probe.get_first_success(
            "Fogadóórák",
            "sajat/Fogadoorak",
            [None, school_week_params, range_params],
        )
        consulting_hour_uid = first_uid(consulting_hours)

        homeworks = probe.get_first_success(
            "Házi feladatok",
            "sajat/HaziFeladatok",
            [school_week_params, None, range_params],
        )
        homework_uid = first_uid(homeworks)

        lessons = probe.get_first_success(
            "Órarendi elemek",
            "sajat/OrarendElemek",
            [school_week_params, None, range_params],
        )
        lesson_uid = first_uid(lessons)
        if homework_uid is None:
            homework_uid = first_direct_value(
                lessons,
                ("HaziFeladatUid", "haziFeladatUid", "HomeWorkUid", "homeWorkUid"),
            )

        probe.get(
            "Bejelentett számonkérések",
            "sajat/BejelentettSzamonkeresek",
            range_params,
        )
        embedded_head_teachers = count_nested_objects(groups, "OsztalyFonok")
        if embedded_head_teachers:
            probe.local_ok(
                "Osztályfőnökök (csoport-adatból)",
                f"{embedded_head_teachers} beágyazott rekord",
            )
        else:
            probe.skip(
                "Osztályfőnökök (csoport-adatból)",
                "a csoportválasz nem tartalmaz ilyen rekordot",
            )
        probe.get("Eszköz kiosztva", "TargyiEszkoz/IsEszkozKiosztva")
        probe.get("Gondviselő adatlap", "sajat/GondviseloAdatlap")
        probe.get("Lázár Ervin Program", "Lep/Eloadasok")
        probe.get("Feljegyzések", "sajat/Feljegyzesek")
        probe.get("Faliújság", "sajat/FaliujsagElemek")
        probe.get("Mulasztások", "sajat/Mulasztasok")
        probe.get("Eszköz regisztrációs állapot", "TargyiEszkoz/IsRegisztralt")
        probe.get("Tanév rendje", "sajat/Intezmenyek/TanevRendjeElemek")
        probe.get(
            "Hetirend",
            "sajat/Intezmenyek/Hetirendek/Orarendi",
            {
                "orarendElemKezdoNapDatuma": (today - timedelta(days=7)).isoformat(),
                "orarendElemVegNapDatuma": (today + timedelta(days=14)).isoformat(),
            },
        )

        if study_task_uids:
            class_average_options: list[Any] = [
                [
                    ("oktatasiNevelesiFeladatUid", study_task_uid),
                    ("oktatasiNevelesiFeladatUid", study_task_uid),
                ]
                for study_task_uid in study_task_uids
            ]
            probe.get_first_success(
                "Osztályátlagok",
                "sajat/Ertekelesek/Atlagok/OsztalyAtlagok",
                class_average_options,
            )
            probe.get_first_success(
                "Tantárgyi átlagok",
                "sajat/Ertekelesek/Atlagok/TantargyiAtlagok",
                [
                    {"oktatasiNevelesiFeladatUid": study_task_uid}
                    for study_task_uid in study_task_uids
                ],
            )
        else:
            probe.skip("Osztályátlagok", "nincs oktatási-nevelési feladat UID")
            probe.skip("Tantárgyi átlagok", "nincs oktatási-nevelési feladat UID")

        if consulting_hour_uid:
            probe.get(
                "Fogadóóra részlete",
                f"sajat/Fogadoorak/{quote(consulting_hour_uid, safe='')}",
            )
        else:
            probe.skip("Fogadóóra részlete", "a listaválasz üres")

        if homework_uid:
            probe.get(
                "Házi feladat részlete",
                f"sajat/HaziFeladatok/{quote(homework_uid, safe='')}",
            )
        else:
            probe.skip("Házi feladat részlete", "a listaválasz üres")

        if lesson_uid:
            probe.get(
                "Órarendi elem részlete",
                "sajat/OrarendElem",
                {"orarendElemUid": lesson_uid},
            )
        else:
            probe.skip("Órarendi elem részlete", "a listaválasz üres")

        probe.skip("Csatolmány letöltése", "fájlletöltést nem indítunk automatikusan")

        print("\nCsak olvasási végpontok eredménye:\n")
        for result in probe.results:
            print(result.render())

        failed = sum(
            result.state not in {"OK", "KIHAGYVA"} for result in probe.results
        )
        succeeded = sum(result.state == "OK" for result in probe.results)
        skipped = sum(result.state == "KIHAGYVA" for result in probe.results)
        print(
            f"\nÖsszesítés: {succeeded} működik, {failed} hibás/nem elérhető, "
            f"{skipped} kihagyva."
        )
        return 0 if failed == 0 else 2
    except SmokeTestError as exc:
        print(f"HIBA: {exc}", file=sys.stderr)
        return 1
    finally:
        if token and token.get("refresh_token"):
            revoke_refresh_token(session, token["refresh_token"])
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
