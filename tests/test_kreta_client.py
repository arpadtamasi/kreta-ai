from __future__ import annotations

import unittest
from unittest.mock import patch

from kreta_client import KretaClient
from kreta_smoke_test import Credentials


class FakeResponse:
    def __init__(self, status_code: int, payload: object) -> None:
        self.status_code = status_code
        self._payload = payload
        self.content = b"json"

    def raise_for_status(self) -> None:
        if not 200 <= self.status_code < 300:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> object:
        return self._payload


class FakeSession:
    def __init__(self, get_responses: list[FakeResponse] | None = None) -> None:
        self.get_responses = get_responses or []
        self.get_calls: list[tuple[str, dict[str, str]]] = []

    def get(self, url: str, *, headers: dict[str, str], **_: object) -> FakeResponse:
        self.get_calls.append((url, headers))
        return self.get_responses.pop(0)


class KretaClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.credentials = Credentials(
            username="test-user",
            password="test-password",
            institute_code="test-institute",
        )

    def test_status_never_returns_credentials_or_tokens(self) -> None:
        client = KretaClient(self.credentials, FakeSession())  # type: ignore[arg-type]
        with patch.object(client, "authenticate"):
            status = client.status()

        rendered = repr(status)
        self.assertNotIn(self.credentials.username, rendered)
        self.assertNotIn(self.credentials.password, rendered)
        self.assertNotIn("access_token", rendered)
        self.assertTrue(status["read_only"])

    def test_absolute_and_parent_paths_are_rejected_before_network(self) -> None:
        session = FakeSession()
        client = KretaClient(self.credentials, session)  # type: ignore[arg-type]

        for path in ("https://example.com", "sajat/../titok"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                client.get_json(path)
        self.assertEqual(session.get_calls, [])

    def test_unauthorized_get_refreshes_once_without_returning_tokens(self) -> None:
        session = FakeSession(
            [FakeResponse(401, {}), FakeResponse(200, {"safe": True})]
        )
        client = KretaClient(self.credentials, session)  # type: ignore[arg-type]

        def authenticate(*, force_refresh: bool = False) -> None:
            token = "second-token" if force_refresh else "first-token"
            client._token = {"access_token": token}

        with patch.object(client, "authenticate", side_effect=authenticate):
            result = client.get_json("sajat/TanuloAdatlap")

        self.assertEqual(result, {"safe": True})
        self.assertEqual(len(session.get_calls), 2)
        self.assertNotEqual(
            session.get_calls[0][1]["Authorization"],
            session.get_calls[1][1]["Authorization"],
        )

    def test_close_revokes_and_forgets_refresh_token(self) -> None:
        session = FakeSession()
        client = KretaClient(self.credentials, session)  # type: ignore[arg-type]
        client._token = {
            "access_token": "temporary-access",
            "refresh_token": "temporary-refresh",
        }

        with patch("kreta_client.revoke_refresh_token", return_value=True) as revoke:
            client.close()

        revoke.assert_called_once_with(session, "temporary-refresh")
        self.assertIsNone(client._token)


if __name__ == "__main__":
    unittest.main()
