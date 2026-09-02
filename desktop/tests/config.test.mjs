import test from "node:test";
import assert from "node:assert/strict";

import { loadChildren, normalizeInstituteCode } from "../server/config.js";
import { KretaError, parseLoginForm } from "../server/kreta-auth.js";

const child1 = {
  KRETA_CHILD1_NAME: "Marci",
  KRETA_CHILD1_USERNAME: "7212345678",
  KRETA_CHILD1_PASSWORD: "titok, vesszővel",
  KRETA_CHILD1_INSTITUTE_CODE: "klik012345678",
};

test("egy gyerek beolvasása", () => {
  const children = loadChildren({ ...child1 });
  assert.equal(children.length, 1);
  assert.deepEqual(children[0], {
    label: "Marci",
    username: "7212345678",
    password: "titok, vesszővel",
    instituteCode: "klik012345678",
  });
});

test("kitöltetlen 2-3. mezőcsoport kimarad", () => {
  const children = loadChildren({
    ...child1,
    KRETA_CHILD2_NAME: "",
    KRETA_CHILD3_PASSWORD: "${user_config.child3_password}",
  });
  assert.equal(children.length, 1);
});

test("két gyerek, hézagos slotokkal is", () => {
  const children = loadChildren({
    ...child1,
    KRETA_CHILD3_NAME: "Benedek",
    KRETA_CHILD3_USERNAME: "7287654321",
    KRETA_CHILD3_PASSWORD: "másik",
    KRETA_CHILD3_INSTITUTE_CODE: "https://klik087654321.e-kreta.hu",
  });
  assert.deepEqual(
    children.map((c) => [c.label, c.instituteCode]),
    [
      ["Marci", "klik012345678"],
      ["Benedek", "klik087654321"],
    ],
  );
});

test("félig kitöltött csoport hibát ad", () => {
  assert.throws(
    () => loadChildren({ ...child1, KRETA_CHILD2_NAME: "Benedek" }),
    (error) => error instanceof KretaError && /hiányosak/.test(error.message),
  );
});

test("duplikált név hibát ad", () => {
  assert.throws(
    () =>
      loadChildren({
        ...child1,
        KRETA_CHILD2_NAME: "marci",
        KRETA_CHILD2_USERNAME: "x",
        KRETA_CHILD2_PASSWORD: "y",
        KRETA_CHILD2_INSTITUTE_CODE: "klik1",
      }),
    KretaError,
  );
});

test("üres beállítás érthető hibát ad", () => {
  assert.throws(
    () => loadChildren({}),
    (error) => error instanceof KretaError && /beállítva/.test(error.message),
  );
});

test("intézménykód normalizálása", () => {
  assert.equal(normalizeInstituteCode(" klik012345678 "), "klik012345678");
  assert.equal(
    normalizeInstituteCode("https://klik012345678.e-kreta.hu/"),
    "klik012345678",
  );
  assert.equal(
    normalizeInstituteCode("klik012345678.e-KRETA.hu"),
    "klik012345678",
  );
  assert.throws(() => normalizeInstituteCode("rossz kód!"), KretaError);
});

test("login űrlap értelmezése", () => {
  const html = `
    <html><body>
    <form method="get" action="/kereses"><input name="q" value="x"></form>
    <form id="loginForm" method="POST" action="/Account/Login?returnUrl=%2Fconnect">
      <input type="hidden" name="__RequestVerificationToken" value="abc&amp;123" />
      <input name="ReturnUrl" value="/connect/authorize/callback?x=1"/>
      <input type="text" name="UserName">
      <input type="password" name="Password" />
    </form>
    </body></html>`;
  const form = parseLoginForm(html);
  assert.equal(form.action, "/Account/Login?returnUrl=%2Fconnect");
  assert.equal(form.fields.__RequestVerificationToken, "abc&123");
  assert.equal(form.fields.ReturnUrl, "/connect/authorize/callback?x=1");
  assert.equal(form.fields.UserName, "");
});
