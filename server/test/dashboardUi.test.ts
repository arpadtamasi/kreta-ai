import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = readFileSync(
  new URL("../web/src/components/ChildProfiles.astro", import.meta.url),
  "utf8",
);

test("the Claude return flow presents its explanation and action together", () => {
  const panelStart = component.indexOf('id="profiles-return-panel"');
  const panelEnd = component.indexOf("</section>", panelStart);

  assert.notEqual(panelStart, -1, "the return flow should have a dedicated panel");
  assert.notEqual(panelEnd, -1, "the return panel should be a bounded semantic section");

  const panel = component.slice(panelStart, panelEnd);
  assert.match(panel, /Még egy lépés/);
  assert.match(panel, /Google-fiókodat/);
  assert.match(panel, /id="profiles-reauth"/);
  assert.match(panel, /Kapcsolódás folytatása/);
});

test("the Claude return action only appears when the return flow needs it", () => {
  assert.match(component, /returnPanel\.hidden = !returnTo;/);
  assert.match(component, /showReturnAction\(\);/);
  assert.match(component, /hideReturnAction\(\);/);
});

test("Offline opens a password connection form while Online removes only the connection", () => {
  assert.match(component, /Online/);
  assert.match(component, /Offline/);
  assert.match(component, /showForm\(profile, connectionButton, true\)/);
  assert.match(component, /name="password" type="password"[^>]+autocomplete="current-password"/);
  assert.match(component, /name="keepAlive" type="checkbox"/);
  assert.match(component, /name="keepAliveUntil" type="date"/);
  assert.match(component, /method: "DELETE"/);
  assert.match(component, /\/connection`/);
  assert.match(component, /A gyerekprofil megmaradt/);
});

test("an unchecked keep-alive choice is explicitly a 30-minute trial", () => {
  assert.match(component, /csak 30 perces próbára lesz online/);
  assert.match(component, /25 percenként megújítja/);
  assert.match(component, /keepAlive: keepAliveInput\.checked/);
});

test("Classroom is a separate, per-child school account connection", () => {
  assert.match(component, /Minden gyerek a saját iskolai Google-fiókját használhatja/);
  assert.match(component, /data-classroom/);
  assert.match(component, /Classroom · nincs/);
  assert.match(component, /\/api\/classroom\/authorize/);
  assert.match(component, /profileId: profile\.id/);
  assert.match(component, /\/api\/classroom\/\$\{encodeURIComponent\(profile\.id\)\}\/connection/);
  assert.match(component, /method: "DELETE"/);
});
