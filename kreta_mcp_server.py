#!/usr/bin/env python3
"""Local, read-only MCP server for the KRÉTA Student API."""

from __future__ import annotations

import threading
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Any, AsyncIterator
from urllib.parse import quote

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from kreta_client import KretaClient
from kreta_smoke_test import SmokeTestError


READ_ONLY = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)
MAX_ITEMS = 500
MAX_RANGE_DAYS = 93

_client: KretaClient | None = None
_client_lock = threading.Lock()


class McpKretaClient(KretaClient):
    """Translate expected KRÉTA failures into concise MCP tool errors."""

    def get_json(self, path: str, params: Any = None) -> Any:
        try:
            return super().get_json(path, params)
        except SmokeTestError as exc:
            raise ToolError(str(exc)) from None

    def status(self) -> dict[str, Any]:
        try:
            return super().status()
        except SmokeTestError as exc:
            raise ToolError(str(exc)) from None


def get_client() -> KretaClient:
    global _client
    with _client_lock:
        if _client is None:
            try:
                _client = McpKretaClient()
            except SmokeTestError as exc:
                raise ToolError(str(exc)) from None
        return _client


@asynccontextmanager
async def lifespan(_: MCPServer[Any]) -> AsyncIterator[None]:
    try:
        yield None
    finally:
        global _client
        with _client_lock:
            client, _client = _client, None
        if client is not None:
            client.close()


mcp = MCPServer(
    "kreta",
    title="KRÉTA (csak olvasás)",
    description="Helyi, csak olvasható hozzáférés a KRÉTA tanulói adatokhoz.",
    instructions=(
        "A toolok érzékeny oktatási adatokat adhatnak vissza. Csak a felhasználó "
        "kifejezett kérésére kérj le adatot, és csak a válaszhoz szükséges mezőket "
        "jelenítsd meg. Módosító vagy törlő művelet nincs."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


def _validate_limit(limit: int) -> int:
    if not 1 <= limit <= MAX_ITEMS:
        raise ToolError(f"A limit 1 és {MAX_ITEMS} közötti egész szám legyen.")
    return limit


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
        raise ToolError("A dátum formátuma YYYY-MM-DD legyen.") from exc

    if end < start:
        raise ToolError("A záró dátum nem lehet korábbi a kezdő dátumnál.")
    if (end - start).days > MAX_RANGE_DAYS:
        raise ToolError(f"Legfeljebb {MAX_RANGE_DAYS} napos időszak kérhető le.")
    return start.isoformat(), end.isoformat()


def _pack(data: Any, limit: int | None = None) -> dict[str, Any]:
    if isinstance(data, list):
        safe_limit = _validate_limit(limit if limit is not None else MAX_ITEMS)
        items = data[:safe_limit]
        return {
            "items": items,
            "returned": len(items),
            "total": len(data),
            "truncated": len(items) < len(data),
        }
    return {"data": data}


def _uid(value: str, label: str) -> str:
    normalized = value.strip()
    if not normalized or len(normalized) > 200:
        raise ToolError(f"Érvénytelen {label}.")
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


@mcp.tool(annotations=READ_ONLY)
def kreta_login() -> dict[str, Any]:
    """Belépés ellenőrzése OAuth 2.0 Authorization Code + PKCE használatával."""
    return get_client().status()


@mcp.tool(annotations=READ_ONLY)
def kreta_student_profile() -> dict[str, Any]:
    """A bejelentkezett tanuló adatlapjának lekérése."""
    return _pack(get_client().get_json("sajat/TanuloAdatlap"))


@mcp.tool(annotations=READ_ONLY)
def kreta_guardian_profile() -> dict[str, Any]:
    """A bejelentkezett fiók gondviselői adatlapjának lekérése."""
    return _pack(get_client().get_json("sajat/GondviseloAdatlap"))


@mcp.tool(annotations=READ_ONLY)
def kreta_class_groups(limit: int = 100) -> dict[str, Any]:
    """A tanuló osztályainak és csoportjainak lekérése."""
    return _pack(get_client().get_json("sajat/OsztalyCsoportok"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_evaluations(limit: int = 100) -> dict[str, Any]:
    """Jegyek és más értékelések lekérése, legfeljebb a megadott darabszámban."""
    return _pack(get_client().get_json("sajat/Ertekelesek"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_absences(limit: int = 100) -> dict[str, Any]:
    """Mulasztások és igazolási állapotuk lekérése."""
    return _pack(get_client().get_json("sajat/Mulasztasok"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_notes(limit: int = 100) -> dict[str, Any]:
    """Tanári és intézményi feljegyzések lekérése."""
    return _pack(get_client().get_json("sajat/Feljegyzesek"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_announcements(limit: int = 100) -> dict[str, Any]:
    """A KRÉTA faliújság-elemeinek lekérése."""
    return _pack(get_client().get_json("sajat/FaliujsagElemek"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_timetable(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 200,
) -> dict[str, Any]:
    """Órarend lekérése egy YYYY-MM-DD dátumtartományra (alapból ±7 nap)."""
    start, end = _date_range(
        start_date, end_date, default_start_days=-7, default_end_days=7
    )
    data = get_client().get_json(
        "sajat/OrarendElemek", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_timetable_item(lesson_uid: str) -> dict[str, Any]:
    """Egy órarendi elem részleteinek lekérése a listából kapott UID alapján."""
    uid = _uid(lesson_uid, "órarendi UID")
    return _pack(
        get_client().get_json("sajat/OrarendElem", {"orarendElemUid": uid})
    )


@mcp.tool(annotations=READ_ONLY)
def kreta_homework(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Házi feladatok lekérése dátumtartományra (alapból az elmúlt 30 és következő 14 nap)."""
    start, end = _date_range(
        start_date, end_date, default_start_days=-30, default_end_days=14
    )
    data = get_client().get_json(
        "sajat/HaziFeladatok", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_homework_detail(homework_uid: str) -> dict[str, Any]:
    """Egy házi feladat részleteinek lekérése a listából kapott UID alapján."""
    uid = _uid(homework_uid, "házi feladat UID")
    return _pack(
        get_client().get_json(f"sajat/HaziFeladatok/{quote(uid, safe='')}")
    )


@mcp.tool(annotations=READ_ONLY)
def kreta_announced_tests(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Bejelentett dolgozatok és számonkérések lekérése dátumtartományra."""
    start, end = _date_range(
        start_date, end_date, default_start_days=-7, default_end_days=30
    )
    data = get_client().get_json(
        "sajat/BejelentettSzamonkeresek", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_consulting_hours(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Fogadóórák lekérése dátumtartományra."""
    start, end = _date_range(
        start_date, end_date, default_start_days=0, default_end_days=60
    )
    data = get_client().get_json(
        "sajat/Fogadoorak", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_consulting_hour_detail(consulting_hour_uid: str) -> dict[str, Any]:
    """Egy fogadóóra részleteinek lekérése a listából kapott UID alapján."""
    uid = _uid(consulting_hour_uid, "fogadóóra UID")
    return _pack(get_client().get_json(f"sajat/Fogadoorak/{quote(uid, safe='')}"))


@mcp.tool(annotations=READ_ONLY)
def kreta_school_calendar(limit: int = 200) -> dict[str, Any]:
    """A tanév rendjének és intézményi napjainak lekérése."""
    return _pack(
        get_client().get_json("sajat/Intezmenyek/TanevRendjeElemek"), limit
    )


@mcp.tool(annotations=READ_ONLY)
def kreta_week_schedule(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Az intézményi heti órarendi beosztás lekérése."""
    start, end = _date_range(
        start_date, end_date, default_start_days=-7, default_end_days=14
    )
    data = get_client().get_json(
        "sajat/Intezmenyek/Hetirendek/Orarendi",
        {
            "orarendElemKezdoNapDatuma": start,
            "orarendElemVegNapDatuma": end,
        },
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_class_averages(limit: int = 100) -> dict[str, Any]:
    """A tanuló csoportjaihoz elérhető osztályátlagok lekérése."""
    client = get_client()
    groups = client.get_json("sajat/OsztalyCsoportok")
    all_averages: list[Any] = []
    for study_task_uid in _study_task_uids(groups):
        # A mobil API ugyanazt a paramétert kétszer várja ennél a végpontnál.
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
    return _pack(all_averages, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_device_status() -> dict[str, Any]:
    """A KRÉTA tárgyi eszköz kiosztási és regisztrációs állapotának lekérése."""
    client = get_client()
    return {
        "assigned": client.get_json("TargyiEszkoz/IsEszkozKiosztva"),
        "registered": client.get_json("TargyiEszkoz/IsRegisztralt"),
    }


@mcp.tool(annotations=READ_ONLY)
def kreta_lazar_ervin_events(limit: int = 100) -> dict[str, Any]:
    """A Lázár Ervin Programhoz tartozó előadások lekérése."""
    return _pack(get_client().get_json("Lep/Eloadasok"), limit)


if __name__ == "__main__":
    mcp.run(transport="stdio")
