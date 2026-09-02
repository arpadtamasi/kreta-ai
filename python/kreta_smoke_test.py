#!/usr/bin/env python3
"""Minimal, read-only KRÉTA authentication and API smoke test.

Credentials are read from a local .env file. Tokens and API responses are kept
in memory and are never printed or written to disk.
"""

from __future__ import annotations

import base64
import hashlib
import os
import re
import secrets
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv


IDP_BASE_URL = "https://idp.e-kreta.hu"
AUTHORIZE_URL = f"{IDP_BASE_URL}/connect/authorize"
TOKEN_URL = f"{IDP_BASE_URL}/connect/token"
REVOCATION_URL = f"{IDP_BASE_URL}/connect/revocation"
REDIRECT_URI = "https://mobil.e-kreta.hu/ellenorzo-student/prod/oauthredirect"
CLIENT_ID = "kreta-ellenorzo-student-mobile-ios"
SCOPE = " ".join(
    (
        "openid",
        "email",
        "offline_access",
        "kreta-ellenorzo-webapi.public",
        "kreta-eugyintezes-webapi.public",
        "kreta-fileservice-webapi.public",
        "kreta-mobile-global-webapi.public",
        "kreta-dkt-webapi.public",
        "kreta-ier-webapi.public",
    )
)
WEB_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
MOBILE_USER_AGENT = "hu.ekreta.tanulo/1.0.5/Android/0/0"
MOBILE_API_KEY = "21ff6c25-d1da-4a68-a811-c881a6057463"
TIMEOUT_SECONDS = 25
INSTITUTE_CODE_PATTERN = re.compile(r"^[A-Za-z0-9-]{2,40}$")


class SmokeTestError(RuntimeError):
    """A safe, user-facing smoke-test failure."""


@dataclass(frozen=True)
class Credentials:
    username: str
    password: str
    institute_code: str
    label: str = ""


def load_credentials() -> Credentials:
    # KRETA_ENV_FILE teszi lehetővé, hogy egy klónból több gyereket is ki
    # lehessen szolgálni: pl. KRETA_ENV_FILE=.env.deak egy második MCP
    # szerverbejegyzésben. Relatív útvonal a projektkönyvtárhoz képest értendő.
    env_file = os.getenv("KRETA_ENV_FILE", "").strip()
    dotenv_path = (
        Path(env_file)
        if env_file and Path(env_file).is_absolute()
        else Path(__file__).resolve().with_name(env_file or ".env")
    )
    # interpolate=False: enélkül a dotenv a ${VALAMI} alakot behelyettesíti
    # az értékekben, ami egy ilyen részletet tartalmazó jelszót csendben
    # elront. Ezt semmilyen escape nem védi ki, csak ez a kapcsoló.
    load_dotenv(dotenv_path=dotenv_path, override=False, interpolate=False)
    values = {
        "KRETA_USERNAME": os.getenv("KRETA_USERNAME", "").strip(),
        "KRETA_PASSWORD": os.getenv("KRETA_PASSWORD", ""),
        "KRETA_INSTITUTE_CODE": os.getenv("KRETA_INSTITUTE_CODE", "").strip(),
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        joined = ", ".join(missing)
        raise SmokeTestError(
            f"Hiányzó változó(k) ebben a fájlban: {dotenv_path.name} ({joined})"
        )

    institute_code = normalize_institute_code(values["KRETA_INSTITUTE_CODE"])

    return Credentials(
        username=values["KRETA_USERNAME"],
        password=values["KRETA_PASSWORD"],
        institute_code=institute_code,
        label=os.getenv("KRETA_LABEL", "").strip(),
    )


def load_all_credentials() -> list[Credentials]:
    """Egy vagy több gyerek hitelesítő adatainak beolvasása.

    Ha a KRETA_CHILD_NAMES (és a hozzá tartozó KRETA_USERNAMES /
    KRETA_PASSWORDS / KRETA_INSTITUTE_CODES) be van állítva, azt vesszővel
    elválasztott listaként értelmezi — ezt tölti ki a plugin natív,
    "multiple" konfigurációs mezője, gyerekenként egy bejegyzéssel. Ha nincs
    beállítva, visszaesik az egygyerekes load_credentials()-re (git clone +
    .env, vagy egygyerekes plugin-telepítés).

    Figyelem: mivel a lista vesszővel elválasztott, egyik érték sem
    tartalmazhat vesszőt — ez elsősorban a jelszónál számít, ezért ezt a
    plugin mezőleírása is jelzi a felhasználónak.
    """
    raw_names = os.getenv("KRETA_CHILD_NAMES", "")
    if not raw_names.strip():
        single = load_credentials()
        return [single]

    def split(value: str) -> list[str]:
        return [item.strip() for item in value.split(",")]

    names = split(raw_names)
    usernames = split(os.getenv("KRETA_USERNAMES", ""))
    passwords = os.getenv("KRETA_PASSWORDS", "").split(",")
    institute_codes = split(os.getenv("KRETA_INSTITUTE_CODES", ""))

    lengths = {len(names), len(usernames), len(passwords), len(institute_codes)}
    if len(lengths) != 1:
        raise SmokeTestError(
            "A KRETA_CHILD_NAMES, KRETA_USERNAMES, KRETA_PASSWORDS és "
            "KRETA_INSTITUTE_CODES változóknak gyerekenként egy, azonos "
            "számú, vesszővel elválasztott elemet kell tartalmazniuk. Ha "
            "valamelyik jelszó vesszőt (,) tartalmaz, ez a beállítási mód "
            "nem használható vele — válassz vessző nélküli jelszót, vagy "
            "telepítsd azt a gyereket külön, saját pluginként."
        )

    children: list[Credentials] = []
    seen: set[str] = set()
    for name, username, password, code in zip(names, usernames, passwords, institute_codes):
        key = name.lower()
        if not name or not username or not password.strip() or not code:
            raise SmokeTestError(f"Hiányos adat ehhez a gyerekhez: {name or '(névtelen)'}.")
        if key in seen:
            raise SmokeTestError(f"Kétszer szerepel ugyanaz a gyerek-név: {name}.")
        seen.add(key)
        children.append(
            Credentials(
                username=username,
                password=password,
                institute_code=normalize_institute_code(code),
                label=name,
            )
        )
    return children


def normalize_institute_code(value: str) -> str:
    candidate = value.strip().rstrip("/")
    if "://" in candidate:
        hostname = urlparse(candidate).hostname
        candidate = hostname or ""
    else:
        candidate = candidate.split("/", maxsplit=1)[0]

    suffix = ".e-kreta.hu"
    if candidate.lower().endswith(suffix):
        candidate = candidate[: -len(suffix)]

    if not INSTITUTE_CODE_PATTERN.fullmatch(candidate):
        raise SmokeTestError(
            "A KRETA_INSTITUTE_CODE mezőbe az intézmény rövid kódját vagy "
            "a https://<kód>.e-kreta.hu címet írd."
        )
    return candidate


def base64url_sha256(value: str) -> str:
    digest = hashlib.sha256(value.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def find_code(location: str, expected_state: str) -> str | None:
    query = parse_qs(urlparse(location).query)
    if "code" not in query:
        return None
    if query.get("state", [None])[0] != expected_state:
        raise SmokeTestError("A bejelentkezési válasz state értéke nem egyezik.")
    return query["code"][0]


def login(session: requests.Session, credentials: Credentials) -> dict[str, str]:
    code_verifier = secrets.token_urlsafe(64)
    state = secrets.token_urlsafe(32)
    params = {
        "prompt": "login",
        "nonce": secrets.token_urlsafe(32),
        "response_type": "code",
        "code_challenge_method": "S256",
        "scope": SCOPE,
        "code_challenge": base64url_sha256(code_verifier),
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "state": state,
        "suppressed_prompt": "login",
    }

    try:
        login_page = session.get(
            AUTHORIZE_URL,
            params=params,
            headers={"User-Agent": WEB_USER_AGENT},
            timeout=TIMEOUT_SECONDS,
        )
        login_page.raise_for_status()
    except requests.RequestException as exc:
        raise SmokeTestError("A KRÉTA bejelentkezési oldal nem érhető el.") from exc

    soup = BeautifulSoup(login_page.text, "html.parser")
    form = soup.find("form", method=lambda value: value and value.lower() == "post")
    if form is None or not form.get("action"):
        raise SmokeTestError("A KRÉTA bejelentkezési űrlapja nem ismerhető fel.")

    payload = {
        element["name"]: element.get("value", "")
        for element in form.find_all("input")
        if element.get("name")
    }
    payload.update(
        {
            "UserName": credentials.username,
            "Password": credentials.password,
            "InstituteCode": credentials.institute_code,
            "IsTemporaryLogin": "False",
            "loginType": "InstituteLogin",
        }
    )
    form_url = urljoin(login_page.url, str(form["action"]))

    try:
        submitted = session.post(
            form_url,
            data=payload,
            headers={
                "User-Agent": WEB_USER_AGENT,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            allow_redirects=False,
            timeout=TIMEOUT_SECONDS,
        )
        submitted.raise_for_status()
    except requests.RequestException as exc:
        raise SmokeTestError("A KRÉTA elutasította a bejelentkezési kérést.") from exc
    finally:
        payload["Password"] = ""

    code = find_code(submitted.headers.get("Location", ""), state)
    if code is None:
        return_url = payload.get("ReturnUrl", "")
        if not return_url:
            raise SmokeTestError("Nem érkezett bejelentkezési visszatérési URL.")
        try:
            callback = session.get(
                urljoin(IDP_BASE_URL, return_url),
                headers={"User-Agent": WEB_USER_AGENT},
                allow_redirects=False,
                timeout=TIMEOUT_SECONDS,
            )
            callback.raise_for_status()
        except requests.RequestException as exc:
            raise SmokeTestError("A KRÉTA bejelentkezési visszahívása sikertelen.") from exc
        code = find_code(callback.headers.get("Location", ""), state)

    if code is None:
        raise SmokeTestError(
            "Sikertelen bejelentkezés. Ellenőrizd az azonosítót, a jelszót és "
            "az intézmény hosszabb kódját."
        )

    try:
        token_response = session.post(
            TOKEN_URL,
            data={
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": REDIRECT_URI,
                "client_id": CLIENT_ID,
                "grant_type": "authorization_code",
            },
            timeout=TIMEOUT_SECONDS,
        )
        token_response.raise_for_status()
        token = token_response.json()
    except (requests.RequestException, ValueError) as exc:
        raise SmokeTestError("A KRÉTA nem adott használható hozzáférési tokent.") from exc

    if not token.get("access_token"):
        raise SmokeTestError("A KRÉTA válaszából hiányzik a hozzáférési token.")
    return token


def check_student_endpoint(
    session: requests.Session, credentials: Credentials, access_token: str
) -> None:
    institute_code = credentials.institute_code.lower()
    url = (
        f"https://{institute_code}.e-kreta.hu/"
        "ellenorzo/v3/sajat/TanuloAdatlap"
    )
    try:
        response = session.get(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "User-Agent": MOBILE_USER_AGENT,
                "apiKey": MOBILE_API_KEY,
            },
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        response.json()
    except (requests.RequestException, ValueError) as exc:
        raise SmokeTestError(
            "A belépés sikerült, de a TanulóAdatlap végpont nem válaszolt megfelelően."
        ) from exc


def revoke_refresh_token(session: requests.Session, refresh_token: str) -> bool:
    try:
        response = session.post(
            REVOCATION_URL,
            data={"token": refresh_token, "client_id": CLIENT_ID},
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return True
    except requests.RequestException:
        return False


def main() -> int:
    token: dict[str, str] | None = None
    session = requests.Session()
    try:
        credentials = load_credentials()
        print("1/3 KRÉTA bejelentkezés ellenőrzése…", flush=True)
        token = login(session, credentials)
        print("2/3 TanulóAdatlap olvasási próba…", flush=True)
        check_student_endpoint(session, credentials, token["access_token"])
        print("3/3 Refresh token visszavonása…", flush=True)
        revoked = revoke_refresh_token(session, token.get("refresh_token", ""))
        token = None
        if not revoked:
            print(
                "FIGYELEM: a próba sikerült, de a refresh token visszavonása nem "
                "volt igazolható.",
                file=sys.stderr,
            )
            return 2
        print("SIKER: a bejelentkezés és az olvasási API-kérés működik.")
        return 0
    except SmokeTestError as exc:
        print(f"HIBA: {exc}", file=sys.stderr)
        return 1
    finally:
        if token and token.get("refresh_token"):
            revoke_refresh_token(session, token["refresh_token"])
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
