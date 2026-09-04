import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const indexPage = read("../web/src/pages/index.astro");
const container = read("../web/src/components/ChildProfiles.astro");
const childList = read("../web/src/components/dashboard/ChildList.astro");
const rowTemplate = read("../web/src/components/dashboard/ChildRowTemplate.astro");
const summary = read("../web/src/components/dashboard/DashboardSummary.astro");
const connector = read("../web/src/components/dashboard/ClaudeConnector.astro");
const adminHelp = read("../web/src/components/dashboard/ClassroomAdminHelp.astro");
const howItWorks = read("../web/src/pages/hogy-mukodik.astro");
const profilesModule = read("../web/src/scripts/dashboard/profiles.ts");
const mainModule = read("../web/src/scripts/dashboard/main.ts");
const childListModule = read("../web/src/scripts/dashboard/childList.ts");
const serviceStatusModule = read("../web/src/scripts/dashboard/serviceStatus.ts");
const astroConfig = read("../astro.config.mjs");

test("the root page is one full-width workspace, with no decorative hero column", () => {
  assert.match(indexPage, /<ChildProfiles \/>/);
  assert.match(indexPage, /<DashboardSummary \/>/);
  assert.match(indexPage, /<ClaudeConnector \/>/);
  assert.doesNotMatch(indexPage, /href="\/dashboard"/);
  assert.doesNotMatch(indexPage, /<h1/, "the page title belongs to the workspace header");
  assert.doesNotMatch(indexPage, /Big Shoulders/, "no display-type hero column on the dashboard");
});

test("the workspace header answers where I am and what to do next", () => {
  assert.match(summary, /<h1>A gyerekeid iskolai adatai Claude-ban\.<\/h1>/);
  assert.match(summary, /Belépés Google-fiókkal/);
  assert.match(summary, /Gyerek hozzáadása és kapcsolása/);
  assert.match(summary, /Csatlakozó másolása Claude-ba/);
  assert.equal((summary.match(/<li data-state=/gu) ?? []).length, 3);
  assert.match(mainModule, /function updateSteps\(signedIn: boolean\)/);
  assert.match(mainModule, /updateSteps\(false\);/);
  assert.match(mainModule, /updateSteps\(true\);/);
});

test("a daily child row carries only the name, two states and a link to the child", () => {
  assert.match(rowTemplate, /class="child-name"/);
  assert.match(rowTemplate, /KRÉTA · Offline/);
  assert.match(rowTemplate, /Classroom · nincs/);
  assert.match(rowTemplate, /<a class="child-manage" href="\/gyerek">Kezelés<\/a>/);

  for (const noise of ["profile-username", "profile-institute", "Szerkesztés", "Törlés", "25 perc"]) {
    assert.ok(!rowTemplate.includes(noise), `the daily row should not carry: ${noise}`);
  }
});

test("the row states are inert text, so no daily click can break a connection", () => {
  assert.equal((rowTemplate.match(/<button/gu) ?? []).length, 0, "the row holds no buttons at all");
  assert.doesNotMatch(rowTemplate, /data-connection|data-classroom/);
  assert.doesNotMatch(rowTemplate, /aria-pressed/);
  assert.match(childListModule, /manage\.href = hrefFor\(profile\)/);
});

test("both entry points lead to the child's own page, keeping the Claude return flow", () => {
  assert.match(childList, /<a class="add-child" id="add-child" href="\/gyerek">\+ Gyerek<\/a>/);
  assert.match(childList, /id="child-empty-link" href="\/gyerek"/);
  assert.match(mainModule, /function childHref\(id\?: string\): string/);
  assert.match(mainModule, /query\.set\("return_to", returnTo\)/);
  assert.match(mainModule, /renderChildList\(profiles, \(profile\) => childHref\(profile\.id\)\)/);
  assert.doesNotMatch(mainModule, /createProfileEditor|createManagePanel/, "no modals left on the dashboard");
});

test("the workspace header summarises how much Claude can reach", () => {
  assert.match(summary, /id="claude-summary"/);
  assert.match(profilesModule, /gyerekből \$\{ready\} elérhető Claude-nak/);
  assert.match(mainModule, /summary\.textContent = claudeSummary\(profiles\)/);
});

test("the service indicator says the service works, not that data is available", () => {
  assert.match(serviceStatusModule, /A szolgáltatás működik/);
  assert.doesNotMatch(serviceStatusModule, /Elérhető/);
});

test("the signed-out state pairs one sign-in control with a preview of the payoff", () => {
  const block = container.slice(container.indexOf('id="profiles-signed-out"'), container.indexOf('id="profiles-signed-in"'));
  assert.equal((block.match(/<button/gu) ?? []).length, 1, "one call to action while signed out");
  assert.match(block, /id="profiles-google-signin"/);
  assert.match(block, /class="preview"/);
  assert.match(block, /Mi a helyzet a gyerekekkel\?/);
  assert.match(block, /dicséretet/);
  assert.match(block, /Példa\. A saját gyerekeid adataival válaszol\./);
});

test("the landing block never flashes while the Google session is still unknown", () => {
  assert.match(container, /id="profiles-loading"/);
  assert.match(container, /<div class="signed-out" id="profiles-signed-out" hidden>/);
  assert.match(container, /<div class="signed-in" id="profiles-signed-in" hidden>/);
  assert.match(container, /<noscript>/);
  assert.match(mainModule, /function showAuthState\(user: User \| null\)/);
  assert.match(mainModule, /if \(authResolved\) return;/, "a blocked Firebase must still reveal the sign-in");
});

test("the Claude connector reads as its own block under the child list", () => {
  assert.match(connector, /\.connector \{[^}]*border-top: 2px solid var\(--blue\)/);
  assert.match(connector, /\.connector \{[^}]*background: #eef2f8/);
  assert.doesNotMatch(container, /\.profiles \{[^}]*border-bottom/);
});

test("the Claude return flow presents its explanation and action together", () => {
  const panelStart = container.indexOf('id="profiles-return-panel"');
  const panelEnd = container.indexOf("</section>", panelStart);

  assert.notEqual(panelStart, -1, "the return flow should have a dedicated panel");
  assert.notEqual(panelEnd, -1, "the return panel should be a bounded semantic section");

  const panel = container.slice(panelStart, panelEnd);
  assert.match(panel, /Még egy lépés/);
  assert.match(panel, /Google-fiókodat/);
  assert.match(panel, /id="profiles-reauth"/);
  assert.match(panel, /Kapcsolódás folytatása/);
});

test("the Claude return action only appears when the return flow needs it", () => {
  assert.match(mainModule, /returnPanel\.hidden = !returnTo;/);
  assert.match(mainModule, /showReturnAction\(\);/);
  assert.match(mainModule, /hideReturnAction\(\);/);
});

test("a result carried back from the child page is shown on the list", () => {
  assert.match(mainModule, /sessionStorage\.getItem\("uzenofuzet-status"\)/);
  assert.match(mainModule, /sessionStorage\.removeItem\("uzenofuzet-status"\)/);
});

test("the admin handoff stays out of the daily view but reachable when it is needed", () => {
  assert.match(adminHelp, /hidden=\{variant === "workspace"\}/);
  assert.match(mainModule, /if \(classroomResult === "blocked"\) revealAdminHelp\(\);/);
  assert.match(mainModule, /adminHelp\.hidden = false;/);
  assert.match(howItWorks, /<ClassroomAdminHelp variant="page" \/>/);
  assert.doesNotMatch(container, /OAuth-kliensazonosító/);
});

test("school admins get a readable, copyable Classroom approval handoff", () => {
  assert.match(adminHelp, /Iskolai Google-adminnak: engedélyezési adatok/);
  assert.match(adminHelp, /Adminadatok másolása/);
  assert.match(
    read("../web/src/scripts/dashboard/classroomAdmin.ts"),
    /navigator\.clipboard\.writeText\(classroomAdminText\(\)\)/,
  );
  assert.match(adminHelp, /Request Access \/ Hozzáférés kérése/);
  assert.match(adminHelp, /Adott Google-adatok/);
  assert.match(adminHelp, /Classroom API adathozzáférés/);

  const clientId = "652545082668-28jv22mkvkjl85hd1rhfard3egnb4dtc.apps.googleusercontent.com";
  assert.match(adminHelp, new RegExp(clientId.replaceAll(".", "\\.")));

  const requestedScopes = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
    "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  ];
  for (const scope of requestedScopes) assert.ok(adminHelp.includes(scope), `missing scope: ${scope}`);
});

test("the client logic lives in modules, not in the profiles component", () => {
  assert.match(container, /import \{ startDashboard \} from "\.\.\/scripts\/dashboard\/main";/);
  assert.ok(container.split("\n").length < 150, "ChildProfiles.astro should stay a thin container");
  assert.doesNotMatch(container, /firebase\/auth/);
  assert.doesNotMatch(container, /fetch\(/);
});

test("component scripts stay external files, because production CSP forbids inline script", () => {
  assert.match(astroConfig, /build: \{ assetsInlineLimit: 0 \}/);
});
