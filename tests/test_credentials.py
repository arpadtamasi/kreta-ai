from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from kreta_smoke_test import Credentials, SmokeTestError, load_all_credentials


MULTI_CHILD_ENV = {
    "KRETA_CHILD_NAMES": "Marci,Benedek",
    "KRETA_USERNAMES": "marci.user,benedek.user",
    "KRETA_PASSWORDS": "marci-jelszo,benedek-jelszo",
    "KRETA_INSTITUTE_CODES": "iskola1,iskola2",
}


class LoadAllCredentialsTest(unittest.TestCase):
    def test_falls_back_to_single_child_when_no_child_names_set(self) -> None:
        single = Credentials(
            username="u", password="p", institute_code="i", label=""
        )
        with patch.dict(os.environ, {"KRETA_CHILD_NAMES": ""}, clear=False):
            with patch("kreta_smoke_test.load_credentials", return_value=single):
                result = load_all_credentials()
        self.assertEqual(result, [single])

    def test_parses_multiple_children_in_order(self) -> None:
        with patch.dict(os.environ, MULTI_CHILD_ENV, clear=False):
            result = load_all_credentials()

        self.assertEqual([c.label for c in result], ["Marci", "Benedek"])
        self.assertEqual(result[0].username, "marci.user")
        self.assertEqual(result[0].password, "marci-jelszo")
        self.assertEqual(result[0].institute_code, "iskola1")
        self.assertEqual(result[1].username, "benedek.user")

    def test_mismatched_list_lengths_raise_actionable_error(self) -> None:
        env = {**MULTI_CHILD_ENV, "KRETA_USERNAMES": "csak-egy-felhasznalo"}
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaisesRegex(SmokeTestError, "azonos számú"):
                load_all_credentials()

    def test_comma_in_password_is_caught_as_length_mismatch(self) -> None:
        # Egy vesszőt tartalmazó jelszó eltolja a KRETA_PASSWORDS lista
        # hosszát a többi listához képest — ezt hibaként kell jeleznünk,
        # nem csendben rossz gyerekhez rendelt jelszóként.
        env = {**MULTI_CHILD_ENV, "KRETA_PASSWORDS": "marci,jelszo,benedek-jelszo"}
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaisesRegex(SmokeTestError, "azonos számú"):
                load_all_credentials()

    def test_duplicate_child_names_are_rejected(self) -> None:
        env = {
            "KRETA_CHILD_NAMES": "Marci,marci",
            "KRETA_USERNAMES": "u1,u2",
            "KRETA_PASSWORDS": "p1,p2",
            "KRETA_INSTITUTE_CODES": "i1,i2",
        }
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaisesRegex(SmokeTestError, "Kétszer szerepel"):
                load_all_credentials()


if __name__ == "__main__":
    unittest.main()
