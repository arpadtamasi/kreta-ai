import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const page = read("../web/src/pages/gyerek.astro");
const details = read("../web/src/components/child/ChildDetails.astro");
const form = read("../web/src/components/child/ProfileForm.astro");
const pageModule = read("../web/src/scripts/child/page.ts");
const keepAlive = read("../web/src/scripts/child/keepAlive.ts");
const classroomRouter = read("../src/classroom/router.ts");

test("the child has a page of its own instead of a scrolling modal", () => {
  assert.match(page, /<ChildDetails \/>/);
  assert.match(page, /<ProfileForm \/>/);
  assert.match(page, /<ClassroomAdminHelp \/>/);
  assert.match(page, /id="child-back"/);
  assert.doesNotMatch(page, /<dialog/);
  assert.doesNotMatch(details, /<dialog/);
  assert.doesNotMatch(form, /<dialog/);
  assert.doesNotMatch(form, /showModal/);
});

test("the page carries the identifiers, both connections and the editor", () => {
  assert.match(details, /id="child-username"/);
  assert.match(details, /id="child-institute"/);
  assert.match(details, /id="child-kreta-connect"/);
  assert.match(details, /id="child-classroom-connect"/);
  assert.match(details, /id="child-edit"[^>]*>Adatok módosítása</);
  assert.ok(
    details.indexOf('id="child-edit"') > details.indexOf('id="panel-kreta"') &&
      details.indexOf('id="child-edit"') < details.indexOf('id="panel-classroom"'),
    "the editor asks for the KRÉTA password on every save, so it belongs to the KRÉTA tab",
  );
  assert.match(pageModule, /kretaDetail\(profile\)/);
  assert.match(pageModule, /classroomDetail\(profile\)/);
  assert.match(pageModule, /openEditor\("connect"\)/);
  assert.match(pageModule, /openEditor\("edit"\)/);
});

test("stopping a connection stays a separate danger-zone action with its own confirmation", () => {
  assert.match(details, /Veszélyzóna/);
  for (const id of ["danger-kreta", "danger-classroom", "danger-delete"]) {
    const start = details.indexOf(`id="${id}"`);
    assert.notEqual(start, -1, `missing danger item: ${id}`);
    const item = details.slice(start, details.indexOf("</div>\n      </div>", start));
    assert.match(item, /data-danger-open/);
    assert.match(item, /data-danger-confirm-box/);
    assert.match(item, /data-danger-confirm/);
    assert.match(item, /data-danger-cancel/);
  }
  assert.match(pageModule, /stopKretaConnection\(user, current\.id\)/);
  assert.match(pageModule, /disconnectClassroom\(user, current\.id\)/);
  assert.match(pageModule, /A gyerekprofil megmaradt/);
});

test("profile deletion spells out that both connections go with it", () => {
  const start = details.indexOf('id="danger-delete"');
  const item = details.slice(start, details.indexOf("</section>", start));
  assert.match(item, /a KRÉTA- és a Classroom-kapcsolat is törlődik/);
  assert.match(item, /A KRÉTA- és a Classroom-kapcsolata is megszűnik/);
  assert.match(pageModule, /deleteProfile\(user, current\.id\)/);
  assert.match(pageModule, /Classroom-kapcsolatával együtt töröltük/);
});

test("keep-alive is a short list of periods instead of a date field", () => {
  assert.doesNotMatch(form, /type="date"/);
  for (const value of ["trial", "7", "14", "30", "none"]) {
    assert.match(form, new RegExp(`name="keepAliveWindow" value="${value}"`));
  }
  assert.match(form, /30 perces próba/);
  assert.match(form, /1 hét/);
  assert.match(form, /2 hét/);
  assert.match(form, /1 hónap/);
  assert.match(form, /Határidő nélkül/);
  assert.match(keepAlive, /end\.setDate\(end\.getDate\(\) \+ Number\(choice\)\)/);
  assert.match(keepAlive, /keepAlive: choice !== "trial"/);
  assert.match(pageModule, /keepAlivePayload\(keepAliveChoice\(\)\)/);
});

test("the connection form still says what happens to the password and the token", () => {
  assert.match(form, /name="password" type="password"[^>]+autocomplete="current-password"/);
  assert.match(form, /A jelszó átmegy a szerveren, de nem mentjük el/);
  assert.match(form, /25 percenként megújítjuk/);
  assert.match(form, /A jelszót nem tároljuk/);
});

test("the page keeps the Claude return flow and hands its result back to the list", () => {
  assert.match(pageModule, /candidateReturn\.startsWith\("\/authorize\?"\)/);
  assert.match(pageModule, /const backHref = returnTo \? `\/\?\$\{new URLSearchParams\(\{ return_to: returnTo \}\)\.toString\(\)\}` : "\/"/);
  assert.match(pageModule, /sessionStorage\.setItem\("uzenofuzet-status"/);
  assert.match(pageModule, /location\.replace\(backHref\)/, "signed-out visitors go back to the sign-in");
});

test("the Classroom authorisation returns to the child that started it", () => {
  assert.match(classroomRouter, /const target = profileId \? new URL\("\/gyerek", issuer\) : new URL\("\/", issuer\)/);
  assert.match(classroomRouter, /target\.searchParams\.set\("id", profileId\)/);
  assert.match(pageModule, /startClassroomAuthorization\(user, current\.id, returnTo\)/);
});

test("the two connectors are equal tabs, not a profile with an external extra", () => {
  assert.match(details, /role="tablist"/);
  for (const id of ["tab-kreta", "tab-classroom", "panel-kreta", "panel-classroom"]) {
    assert.ok(details.includes(`id="${id}"`), `missing tab element: ${id}`);
  }
  assert.ok(
    details.indexOf('id="child-username"') > details.indexOf('id="panel-kreta"'),
    "the KRÉTA credentials belong to the KRÉTA connector, not to the profile header",
  );
  assert.match(pageModule, /function selectTab\(id: "kreta" \| "classroom"\)/);
  assert.match(pageModule, /selectTab\("classroom"\)/, "returning from Google opens the Classroom tab");
});

test("a school block stays visible at the button instead of a status line that scrolls away", () => {
  assert.match(details, /id="child-classroom-hint"/, "the Request Access tip is there before any block");
  assert.match(details, /id="child-classroom-blocked"/);
  assert.match(details, /Request Access/);
  assert.match(details, /href="\/iskolai-admin"/);
  assert.match(pageModule, /uzenofuzet-classroom-blocked:/, "the block is remembered per child");
  assert.match(pageModule, /writeBlocked\(classroomResult === "blocked"\)/);
  assert.match(pageModule, /classroomConnect\.textContent = blocked/);
  assert.match(pageModule, /navigator\.clipboard\.writeText\(schoolLetter\(\)\)/);
});

test("the page reveals itself only once the right title is in place", () => {
  assert.match(page, /<h1 id="child-title"><\/h1>/, "no 'add a child' heading flashes while loading");
  assert.match(pageModule, /function reveal\(\)/);
  assert.match(pageModule, /title\.textContent = "Gyerek hozzáadása";/);
  assert.doesNotMatch(pageModule, /loading\.hidden = true;\n    body\.hidden = false;\n    try/);
});
