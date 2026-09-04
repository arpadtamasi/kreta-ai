import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const indexPage = read("../web/src/pages/index.astro");
const container = read("../web/src/components/ChildProfiles.astro");
const childList = read("../web/src/components/dashboard/ChildList.astro");
const rowTemplate = read("../web/src/components/dashboard/ChildRowTemplate.astro");
const managePanel = read("../web/src/components/dashboard/ChildManagePanel.astro");
const profileEditor = read("../web/src/components/dashboard/ProfileEditor.astro");
const summary = read("../web/src/components/dashboard/DashboardSummary.astro");
const adminHelp = read("../web/src/components/dashboard/ClassroomAdminHelp.astro");
const connector = read("../web/src/components/dashboard/ClaudeConnector.astro");
const howItWorks = read("../web/src/pages/hogy-mukodik.astro");
const profilesModule = read("../web/src/scripts/dashboard/profiles.ts");
const mainModule = read("../web/src/scripts/dashboard/main.ts");
const managePanelModule = read("../web/src/scripts/dashboard/managePanel.ts");
const serviceStatusModule = read("../web/src/scripts/dashboard/serviceStatus.ts");

test("the root page is one full-width workspace, with no decorative hero column", () => {
  assert.match(indexPage, /<ChildProfiles \/>/);
  assert.match(indexPage, /<DashboardSummary \/>/);
  assert.match(indexPage, /<ClaudeConnector \/>/);
  assert.doesNotMatch(indexPage, /href="\/dashboard"/);
  assert.doesNotMatch(indexPage, /<h1/, "the page title belongs to the workspace header");
  assert.doesNotMatch(indexPage, /Big Shoulders/, "no display-type hero column on the dashboard");
  assert.doesNotMatch(indexPage, /grid-template-columns/, "the workspace is a single column");
});

test("the workspace header answers where I am and what to do next", () => {
  assert.match(summary, /<h1>A gyerekeid iskolai adatai Claude-ban\.<\/h1>/);
  assert.match(summary, /Belépés Google-fiókkal/);
  assert.match(summary, /Gyerek hozzáadása és kapcsolása/);
  assert.match(summary, /Csatlakozó másolása Claude-ba/);
  assert.equal((summary.match(/<li data-state=/gu) ?? []).length, 3);
  assert.match(mainModule, /function updateSteps\(signedIn: boolean\)/);
  assert.match(mainModule, /step\.dataset\.state = state;/);
  assert.match(mainModule, /updateSteps\(false\);/);
  assert.match(mainModule, /updateSteps\(true\);/);
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

test("the Claude connector reads as its own block under the child list", () => {
  assert.match(connector, /\.connector \{[^}]*border-top: 2px solid var\(--blue\)/);
  assert.match(connector, /\.connector \{[^}]*background: #eef2f8/);
  assert.doesNotMatch(container, /\.profiles \{[^}]*border-bottom/);
});

test("a daily child row carries only the name, two states and Kezelés", () => {
  assert.match(rowTemplate, /class="child-name"/);
  assert.match(rowTemplate, /KRÉTA · Offline/);
  assert.match(rowTemplate, /Classroom · nincs/);
  assert.match(rowTemplate, /class="child-manage" type="button">Kezelés</);

  for (const noise of ["profile-username", "profile-institute", "Szerkesztés", "Törlés", "25 perc"]) {
    assert.ok(!rowTemplate.includes(noise), `the daily row should not carry: ${noise}`);
  }
});

test("the row states are inert text, so no daily click can break a connection", () => {
  const buttons = rowTemplate.match(/<button/gu) ?? [];
  assert.equal(buttons.length, 1, "only Kezelés may be a button in the row");
  assert.doesNotMatch(rowTemplate, /data-connection|data-classroom/);
  assert.doesNotMatch(rowTemplate, /aria-pressed/);
});

test("+ Gyerek stays a single small secondary control in the Gyerekek header", () => {
  const header = childList.slice(childList.indexOf("<header>"), childList.indexOf("</header>"));
  assert.match(header, /id="add-child"[^>]*>\+ Gyerek</);
  assert.equal((childList.match(/id="add-child"/gu) ?? []).length, 1);
  assert.doesNotMatch(childList, /Gyerekprofil hozzáadása/);
});

test("the manage panel holds the identifiers, the editor and both connections", () => {
  assert.match(managePanel, /id="manage-username"/);
  assert.match(managePanel, /id="manage-institute"/);
  assert.match(managePanel, /id="manage-edit"[^>]*>Profil szerkesztése</);
  assert.match(managePanel, /id="manage-kreta-connect"/);
  assert.match(managePanel, /id="manage-classroom-connect"/);
  assert.match(managePanelModule, /kretaDetail\(profile\)/);
  assert.match(managePanelModule, /classroomDetail\(profile\)/);
  assert.match(profilesModule, /25 percenként frissül/);
  assert.match(profilesModule, /jár le/);
});

test("stopping a connection is a separate danger-zone action with its own confirmation", () => {
  assert.match(managePanel, /Veszélyzóna/);
  for (const id of ["danger-kreta", "danger-classroom", "danger-delete"]) {
    const start = managePanel.indexOf(`id="${id}"`);
    assert.notEqual(start, -1, `missing danger item: ${id}`);
    const item = managePanel.slice(start, managePanel.indexOf("</div>\n      </div>", start));
    assert.match(item, /data-danger-open/);
    assert.match(item, /data-danger-confirm-box/);
    assert.match(item, /data-danger-confirm/);
    assert.match(item, /data-danger-cancel/);
  }
  assert.match(managePanelModule, /stopKretaConnection\(user, profile\.id\)/);
  assert.match(managePanelModule, /disconnectClassroom\(user, profile\.id\)/);
  assert.match(managePanelModule, /A gyerekprofil megmaradt/);
});

test("profile deletion spells out that both connections go with it", () => {
  const start = managePanel.indexOf('id="danger-delete"');
  const item = managePanel.slice(start, managePanel.indexOf("</section>", start));
  assert.match(item, /a KRÉTA- és a Classroom-kapcsolat is törlődik/);
  assert.match(item, /A KRÉTA- és a Classroom-kapcsolata is megszűnik/);
  assert.match(managePanelModule, /deleteProfile\(user, profile\.id\)/);
  assert.match(managePanelModule, /Classroom-kapcsolatával együtt töröltük/);
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

test("Offline opens a password connection form while Online removes only the connection", () => {
  assert.match(profilesModule, /Online/);
  assert.match(profilesModule, /Offline/);
  assert.match(managePanelModule, /deps\.editProfile\(profile, "connect"\)/);
  assert.match(profileEditor, /name="password" type="password"[^>]+autocomplete="current-password"/);
  assert.match(profileEditor, /name="keepAlive" type="checkbox"/);
  assert.match(profileEditor, /name="keepAliveUntil" type="date"/);
});

test("an unchecked keep-alive choice is explicitly a 30-minute trial", () => {
  assert.match(profileEditor, /csak 30 perces próbára lesz online/);
  assert.match(profileEditor, /25 percenként megújítja/);
  assert.match(read("../web/src/scripts/dashboard/editor.ts"), /keepAlive: keepAliveInput\.checked/);
});

test("Classroom is a separate, per-child school account connection", () => {
  assert.match(container, /minden gyerek a saját iskolai Google-fiókját használhatja/i);
  assert.match(managePanel, /Google Classroom/);
  const api = read("../web/src/scripts/dashboard/api.ts");
  assert.match(api, /\/api\/classroom\/authorize/);
  assert.match(api, /profileId/);
  assert.match(api, /\/api\/classroom\/\$\{encodeURIComponent\(id\)\}\/connection/);
  assert.match(api, /method: "DELETE"/);
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
  assert.ok(container.split("\n").length < 130, "ChildProfiles.astro should stay a thin container");
  assert.doesNotMatch(container, /firebase\/auth/);
  assert.doesNotMatch(container, /fetch\(/);
});
