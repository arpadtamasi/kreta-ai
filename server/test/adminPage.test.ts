import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const adminPage = read("../web/src/pages/iskolai-admin.astro");
const adminPageModule = read("../web/src/scripts/adminPage.ts");
const adminHelp = read("../web/src/components/dashboard/ClassroomAdminHelp.astro");
const howItWorks = read("../web/src/pages/hogy-mukodik.astro");
const footer = read("../web/src/components/SiteFooter.astro");
const classroomAuth = read("../src/classroom/auth.ts");

test("the school admin page is reachable from every surface a parent can hand over", () => {
  assert.match(footer, /href="\/iskolai-admin"/);
  assert.match(howItWorks, /href="\/iskolai-admin"/);
  assert.match(adminHelp, /href="\/iskolai-admin"/);
  assert.match(
    read("../web/src/scripts/dashboard/classroomAdmin.ts"),
    /https:\/\/uzenofuzet\.hu\/iskolai-admin/,
  );
  assert.match(adminPage, /data-copy="link"/, "the parent can copy the link to send to the school");
});

test("the admin page hands out the same client id and scopes as the dashboard block", () => {
  const clientId = "652545082668-28jv22mkvkjl85hd1rhfard3egnb4dtc.apps.googleusercontent.com";
  assert.ok(adminHelp.includes(clientId), "the dashboard block still carries the client id");
  assert.ok(adminPage.includes(clientId), "the admin page must not drift from the dashboard block");

  const scopes = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    ...Array.from(classroomAuth.matchAll(/"(https:\/\/www\.googleapis\.com\/auth\/classroom[^"]+)"/gu))
      .map((match) => match[1]!),
  ];
  assert.equal(scopes.length, 6);
  for (const scope of scopes) {
    assert.ok(adminPage.includes(scope), `missing scope on the admin page: ${scope}`);
    assert.ok(adminHelp.includes(scope), `missing scope in the dashboard block: ${scope}`);
  }
});

test("an admin can see what is called, what is refused and how to revoke it", () => {
  assert.match(adminPage, /GET \/v1\/courses/);
  assert.match(adminPage, /studentSubmissions/);
  assert.match(adminPage, /userId=me/, "submissions stay limited to the child's own account");
  assert.match(adminPage, /Alkalmazáshozzáférés kezelése \(Manage App Access\)/);
  assert.match(adminPage, /Adott Google-adatok \(Specific Google data\)/);
  assert.match(adminPage, /Classroom API adathozzáférés/);
  assert.match(adminPage, /myaccount\.google\.com\/permissions/);
  assert.match(adminPage, /id="revoke-title"/);
});

test("the admin page says plainly that the answers reach Claude", () => {
  assert.match(adminPage, /Claude-beszélgetésbe kerülnek/);
  assert.match(adminPage, /Anthropic/);
});

test("the admin page keeps its script external, because production CSP forbids inline script", () => {
  assert.match(adminPage, /import \{ startAdminPage \} from "\.\.\/scripts\/adminPage";/);
  assert.doesNotMatch(adminPage, /addEventListener/);
  assert.match(adminPageModule, /navigator\.clipboard\.writeText\(build\(\)\)/);
});
