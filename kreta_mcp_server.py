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
from kreta_smoke_test import Credentials, SmokeTestError, load_all_credentials


READ_ONLY = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)
MAX_ITEMS = 500
MAX_RANGE_DAYS = 93

_children: list[Credentials] | None = None
_clients: dict[str, "McpKretaClient"] = {}
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


def _load_children() -> list[Credentials]:
    global _children
    if _children is None:
        try:
            _children = load_all_credentials()
        except SmokeTestError as exc:
            raise ToolError(str(exc)) from None
    return _children


def get_client(child: str | None = None) -> KretaClient:
    """A megfelelő gyerek KRÉTA-klienséé adja vissza (egy gyereknél a `child`
    nem kötelező); több gyereknél kötelező, és hibát ad, ha nincs ilyen név.
    """
    children = _load_children()
    with _client_lock:
        if len(children) == 1:
            credentials = children[0]
        else:
            if not child or not child.strip():
                names = ", ".join(c.label for c in children)
                raise ToolError(
                    f"Több gyerek van beállítva ({names}) — add meg, "
                    "melyikről legyen szó a 'child' paraméterrel."
                )
            matches = [c for c in children if c.label.lower() == child.strip().lower()]
            if not matches:
                names = ", ".join(c.label for c in children)
                raise ToolError(
                    f"Nincs ilyen néven beállított gyerek: {child!r}. "
                    f"Elérhető nevek: {names}."
                )
            credentials = matches[0]

        key = credentials.label or credentials.username
        if key not in _clients:
            try:
                _clients[key] = McpKretaClient(credentials=credentials)
            except SmokeTestError as exc:
                raise ToolError(str(exc)) from None
        return _clients[key]


@asynccontextmanager
async def lifespan(_: MCPServer[Any]) -> AsyncIterator[None]:
    try:
        yield None
    finally:
        global _clients
        with _client_lock:
            clients, _clients = _clients, {}
        for client in clients.values():
            client.close()


mcp = MCPServer(
    "kreta",
    title="KRÉTA (csak olvasás)",
    description="Helyi, csak olvasható hozzáférés a KRÉTA tanulói adatokhoz.",
    instructions=(
        "A toolok érzékeny oktatási adatokat adhatnak vissza. Csak a felhasználó "
        "kifejezett kérésére kérj le adatot, és csak a válaszhoz szükséges mezőket "
        "jelenítsd meg. Módosító vagy törlő művelet nincs. Ha több gyerek van "
        "beállítva, minden tool elfogad egy 'child' paramétert (a gyerek nevét) "
        "— ha a felhasználó név szerint kérdez ('Mi van Marcinak?'), azt add át; "
        "ha egy tool 'child' nélkül hibát ad a több gyerek miatt, a hibaüzenet "
        "felsorolja az elérhető neveket."
    ),
    version="0.2.2",
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
def kreta_login(child: str | None = None) -> dict[str, Any]:
    """Belépés ellenőrzése OAuth 2.0 Authorization Code + PKCE használatával.

    Ha nincs 'child' megadva és több gyerek van beállítva, mindegyiket
    ellenőrzi, és gyerekenkénti státuszt ad vissza.
    """
    children = _load_children()
    if child is None and len(children) > 1:
        result: dict[str, Any] = {}
        for c in children:
            try:
                result[c.label] = get_client(c.label).status()
            except ToolError as exc:
                result[c.label] = {"authenticated": False, "error": str(exc)}
        return result
    return get_client(child).status()


@mcp.tool(annotations=READ_ONLY)
def kreta_student_profile(child: str | None = None) -> dict[str, Any]:
    """A bejelentkezett tanuló adatlapjának lekérése."""
    return _pack(get_client(child).get_json("sajat/TanuloAdatlap"))


@mcp.tool(annotations=READ_ONLY)
def kreta_guardian_profile(child: str | None = None) -> dict[str, Any]:
    """A bejelentkezett fiók gondviselői adatlapjának lekérése."""
    return _pack(get_client(child).get_json("sajat/GondviseloAdatlap"))


@mcp.tool(annotations=READ_ONLY)
def kreta_class_groups(limit: int = 100, child: str | None = None) -> dict[str, Any]:
    """A tanuló osztályainak és csoportjainak lekérése."""
    return _pack(get_client(child).get_json("sajat/OsztalyCsoportok"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_evaluations(limit: int = 100, child: str | None = None) -> dict[str, Any]:
    """Jegyek és más értékelések lekérése, legfeljebb a megadott darabszámban."""
    return _pack(get_client(child).get_json("sajat/Ertekelesek"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_absences(limit: int = 100, child: str | None = None) -> dict[str, Any]:
    """Mulasztások és igazolási állapotuk lekérése."""
    return _pack(get_client(child).get_json("sajat/Mulasztasok"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_notes(limit: int = 100, child: str | None = None) -> dict[str, Any]:
    """Tanári és intézményi feljegyzések lekérése."""
    return _pack(get_client(child).get_json("sajat/Feljegyzesek"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_announcements(limit: int = 100, child: str | None = None) -> dict[str, Any]:
    """A KRÉTA faliújság-elemeinek lekérése."""
    return _pack(get_client(child).get_json("sajat/FaliujsagElemek"), limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_timetable(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 200,
    child: str | None = None,
) -> dict[str, Any]:
    """Órarend lekérése egy YYYY-MM-DD dátumtartományra (alapból ±7 nap)."""
    start, end = _date_range(
        start_date, end_date, default_start_days=-7, default_end_days=7
    )
    data = get_client(child).get_json(
        "sajat/OrarendElemek", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_timetable_item(lesson_uid: str, child: str | None = None) -> dict[str, Any]:
    """Egy órarendi elem részleteinek lekérése a listából kapott UID alapján."""
    uid = _uid(lesson_uid, "órarendi UID")
    return _pack(
        get_client(child).get_json("sajat/OrarendElem", {"orarendElemUid": uid})
    )


@mcp.tool(annotations=READ_ONLY)
def kreta_homework(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
    child: str | None = None,
) -> dict[str, Any]:
    """Házi feladatok lekérése dátumtartományra (alapból az elmúlt 30 és következő 14 nap)."""
    start, end = _date_range(
        start_date, end_date, default_start_days=-30, default_end_days=14
    )
    data = get_client(child).get_json(
        "sajat/HaziFeladatok", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_homework_detail(homework_uid: str, child: str | None = None) -> dict[str, Any]:
    """Egy házi feladat részleteinek lekérése a listából kapott UID alapján."""
    uid = _uid(homework_uid, "házi feladat UID")
    return _pack(
        get_client(child).get_json(f"sajat/HaziFeladatok/{quote(uid, safe='')}")
    )


@mcp.tool(annotations=READ_ONLY)
def kreta_announced_tests(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
    child: str | None = None,
) -> dict[str, Any]:
    """Bejelentett dolgozatok és számonkérések lekérése dátumtartományra."""
    start, end = _date_range(
        start_date, end_date, default_start_days=-7, default_end_days=30
    )
    data = get_client(child).get_json(
        "sajat/BejelentettSzamonkeresek", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_consulting_hours(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
    child: str | None = None,
) -> dict[str, Any]:
    """Fogadóórák lekérése dátumtartományra."""
    start, end = _date_range(
        start_date, end_date, default_start_days=0, default_end_days=60
    )
    data = get_client(child).get_json(
        "sajat/Fogadoorak", {"datumTol": start, "datumIg": end}
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_consulting_hour_detail(
    consulting_hour_uid: str, child: str | None = None
) -> dict[str, Any]:
    """Egy fogadóóra részleteinek lekérése a listából kapott UID alapján."""
    uid = _uid(consulting_hour_uid, "fogadóóra UID")
    return _pack(
        get_client(child).get_json(f"sajat/Fogadoorak/{quote(uid, safe='')}")
    )


@mcp.tool(annotations=READ_ONLY)
def kreta_school_calendar(limit: int = 200, child: str | None = None) -> dict[str, Any]:
    """A tanév rendjének és intézményi napjainak lekérése."""
    return _pack(
        get_client(child).get_json("sajat/Intezmenyek/TanevRendjeElemek"), limit
    )


@mcp.tool(annotations=READ_ONLY)
def kreta_week_schedule(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
    child: str | None = None,
) -> dict[str, Any]:
    """Az intézményi heti órarendi beosztás lekérése."""
    start, end = _date_range(
        start_date, end_date, default_start_days=-7, default_end_days=14
    )
    data = get_client(child).get_json(
        "sajat/Intezmenyek/Hetirendek/Orarendi",
        {
            "orarendElemKezdoNapDatuma": start,
            "orarendElemVegNapDatuma": end,
        },
    )
    return _pack(data, limit)


@mcp.tool(annotations=READ_ONLY)
def kreta_class_averages(limit: int = 100, child: str | None = None) -> dict[str, Any]:
    """A tanuló csoportjaihoz elérhető osztályátlagok lekérése."""
    client = get_client(child)
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
def kreta_device_status(child: str | None = None) -> dict[str, Any]:
    """A KRÉTA tárgyi eszköz kiosztási és regisztrációs állapotának lekérése."""
    client = get_client(child)
    return {
        "assigned": client.get_json("TargyiEszkoz/IsEszkozKiosztva"),
        "registered": client.get_json("TargyiEszkoz/IsRegisztralt"),
    }


@mcp.tool(annotations=READ_ONLY)
def kreta_lazar_ervin_events(limit: int = 100, child: str | None = None) -> dict[str, Any]:
    """A Lázár Ervin Programhoz tartozó előadások lekérése."""
    return _pack(get_client(child).get_json("Lep/Eloadasok"), limit)


if __name__ == "__main__":
    mcp.run(transport="stdio")
