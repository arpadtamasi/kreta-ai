import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { parseInstituteSelector, searchKretaInstitutes } from "../src/institutes/search.js";

const selectorHtml = `
  <li><a href="#" class="dropdown-item" data-val="klik034802001">Budenz J&#xF3;zsef &#xC1;ltal&#xE1;nos Iskola &#xE9;s Gimn&#xE1;zium (klik034802001 - 034802)</a></li>
  <li><a href="#" class="dropdown-item" data-val="BUDENZ-OKTATAS">Budenz J&#xF3;zsef Gimn&#xE1;zium Alap&#xED;tv&#xE1;ny (BUDENZ-OKTATAS)</a></li>
`;

test("the eKRÉTA selector HTML becomes bounded name/code suggestions", () => {
  assert.deepEqual(parseInstituteSelector(selectorHtml), [
    { code: "klik034802001", name: "Budenz József Általános Iskola és Gimnázium" },
    { code: "BUDENZ-OKTATAS", name: "Budenz József Gimnázium Alapítvány" },
  ]);
});

test("the upstream request stays on the fixed live-institute endpoint", async () => {
  let requestedUrl = "";
  const suggestions = await searchKretaInstitutes("  Budenz József  ", async (input) => {
    requestedUrl = String(input);
    return new Response(selectorHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  });
  assert.equal(
    requestedUrl,
    "https://intezmenykereso.e-kreta.hu/instituteSelector/Budenz%20J%C3%B3zsef?showOnlyLive=true",
  );
  assert.equal(suggestions[0]?.code, "klik034802001");
});

const config = loadConfig({ TOKEN_SEALING_KEY: randomBytes(32).toString("base64") } as NodeJS.ProcessEnv);
const queries: string[] = [];
const server = createApp({
  config,
  verifyFirebaseIdToken: async (token) => {
    if (token === "anna-token") return { uid: "anna-uid", name: "Anna Példa" };
    throw new Error("invalid token");
  },
  searchInstitutes: async (query) => {
    queries.push(query);
    if (query === "hiba") throw new Error("upstream unavailable");
    return [{ code: "klik034802001", name: "Budenz József Általános Iskola és Gimnázium" }];
  },
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => void server.close());

function instituteRequest(q: string, token?: string) {
  return fetch(`${base}/api/institutes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ q }),
  });
}

test("institution search requires Google identity and a useful query", async () => {
  assert.equal((await instituteRequest("budenz")).status, 401);
  assert.equal((await instituteRequest("bu", "anna-token")).status, 400);
});

test("a verified parent receives cached institution suggestions", async () => {
  const first = await instituteRequest(" Budenz ", "anna-token");
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    suggestions: [{ code: "klik034802001", name: "Budenz József Általános Iskola és Gimnázium" }],
  });
  assert.equal((await instituteRequest("budenz", "anna-token")).status, 200);
  assert.deepEqual(queries, ["Budenz"]);
});

test("upstream failure keeps manual institution-code entry available", async () => {
  const response = await instituteRequest("hiba", "anna-token");
  assert.equal(response.status, 502);
  assert.match(((await response.json()) as { error: string }).error, /kézzel is beírhatod/u);
});
