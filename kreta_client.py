"""In-memory, read-only KRÉTA API client for the local MCP server."""

from __future__ import annotations

import threading
import time
from typing import Any

import requests

from kreta_smoke_test import (
    CLIENT_ID,
    MOBILE_API_KEY,
    MOBILE_USER_AGENT,
    TIMEOUT_SECONDS,
    TOKEN_URL,
    Credentials,
    SmokeTestError,
    load_credentials,
    login,
    revoke_refresh_token,
)


class KretaClient:
    """Authenticate with OAuth 2.0 + PKCE and call fixed read-only API routes.

    Access and refresh tokens live only in memory. The class refreshes an
    expiring access token and revokes the refresh token when it is closed.
    """

    def __init__(
        self,
        credentials: Credentials | None = None,
        session: requests.Session | None = None,
    ) -> None:
        self.credentials = credentials or load_credentials()
        self.session = session or requests.Session()
        self._owns_session = session is None
        self._token: dict[str, Any] | None = None
        self._expires_at = 0.0
        self._lock = threading.RLock()
        self.base_url = (
            f"https://{self.credentials.institute_code.lower()}.e-kreta.hu/"
            "ellenorzo/v3/"
        )

    def authenticate(self, *, force_refresh: bool = False) -> None:
        """Ensure a usable access token is available."""
        with self._lock:
            if (
                not force_refresh
                and self._token
                and self._token.get("access_token")
                and time.monotonic() < self._expires_at - 60
            ):
                return

            refresh_token = str((self._token or {}).get("refresh_token", ""))
            if refresh_token:
                try:
                    self._token = self._refresh(refresh_token)
                    self._set_expiry(self._token)
                    return
                except SmokeTestError:
                    # A rejected/expired refresh token is safe to replace with a
                    # fresh Authorization Code + PKCE login.
                    self._token = None
                    self._expires_at = 0.0

            self._token = login(self.session, self.credentials)
            self._set_expiry(self._token)

    def _refresh(self, refresh_token: str) -> dict[str, Any]:
        try:
            response = self.session.post(
                TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": CLIENT_ID,
                },
                timeout=TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            token = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise SmokeTestError("A KRÉTA hozzáférési token frissítése sikertelen.") from exc

        if not token.get("access_token"):
            raise SmokeTestError("A frissített KRÉTA-tokenből hiányzik az access token.")
        if not token.get("refresh_token"):
            token["refresh_token"] = refresh_token
        return token

    def _set_expiry(self, token: dict[str, Any]) -> None:
        try:
            expires_in = max(1, int(token.get("expires_in", 300)))
        except (TypeError, ValueError):
            expires_in = 300
        self._expires_at = time.monotonic() + expires_in

    def get_json(self, path: str, params: Any = None) -> Any:
        """GET a relative Student API path and return its decoded JSON."""
        normalized_path = path.lstrip("/")
        if (
            not normalized_path
            or "://" in normalized_path
            or ".." in normalized_path.split("/")
        ):
            raise ValueError("Csak relatív, rögzített KRÉTA API-útvonal használható.")

        for attempt in range(2):
            self.authenticate(force_refresh=attempt == 1)
            access_token = str((self._token or {}).get("access_token", ""))
            try:
                response = self.session.get(
                    self.base_url + normalized_path,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "User-Agent": MOBILE_USER_AGENT,
                        "apiKey": MOBILE_API_KEY,
                        "Accept": "application/json",
                    },
                    params=params,
                    timeout=TIMEOUT_SECONDS,
                )
            except requests.RequestException as exc:
                raise SmokeTestError("A KRÉTA API-kérés hálózati hibával leállt.") from exc

            if response.status_code == 401 and attempt == 0:
                continue
            if not 200 <= response.status_code < 300:
                raise SmokeTestError(
                    f"A KRÉTA API HTTP {response.status_code} választ adott."
                )
            if response.status_code == 204 or not response.content:
                return None
            try:
                return response.json()
            except ValueError as exc:
                raise SmokeTestError("A KRÉTA API nem JSON választ adott.") from exc

        raise SmokeTestError("A KRÉTA munkamenet nem frissíthető.")

    def status(self) -> dict[str, Any]:
        """Authenticate and return non-sensitive connection metadata."""
        self.authenticate()
        return {
            "authenticated": True,
            "label": self.credentials.label or None,
            "institution": self.credentials.institute_code,
            "authentication": "OAuth 2.0 Authorization Code + PKCE",
            "read_only": True,
            "token_storage": "memory_only",
        }

    def close(self) -> None:
        """Revoke the in-memory refresh token and close the HTTP session."""
        with self._lock:
            refresh_token = str((self._token or {}).get("refresh_token", ""))
            self._token = None
            self._expires_at = 0.0
            if refresh_token:
                revoke_refresh_token(self.session, refresh_token)
            if self._owns_session:
                self.session.close()

    def __enter__(self) -> KretaClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
