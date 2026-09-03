import assert from "node:assert/strict";
import { test } from "node:test";
import { KretaError, normalizeInstituteCode } from "../src/kreta/institute.js";
import { KretaClient } from "../src/kreta/client.js";
import { parseLoginForm } from "../src/kreta/loginForm.js";
import { ReplayCache } from "../src/oauth/replayCache.js";
import { dateRange, pack, studyTaskUids, validateLimit } from "../src/mcp/shape.js";
import { ToolError } from "../src/mcp/context.js";

test("institute codes are accepted in every shape a parent might copy", () => {
  for (const input of ["klik123456", "KLIK123456", " klik123456 ", "klik123456.e-kreta.hu", "https://klik123456.e-kreta.hu", "https://klik123456.e-kreta.hu/"]) {
    assert.equal(normalizeInstituteCode(input).toLowerCase(), "klik123456");
  }
});

test("a non-institute value is rejected with a readable message", () => {
  for (const input of ["", "  ", "a", "https://example.com/../etc", "kód with space"]) {
    assert.throws(() => normalizeInstituteCode(input), KretaError);
  }
});

test("the login form parser reads the action and every named input", () => {
  const html = `
    <html><body>
      <form method="get" action="/search"><input name="q"></form>
      <form method="POST" action="/account/login?ReturnUrl=%2Fconnect%2Fauthorize">
        <input type="hidden" name="__RequestVerificationToken" value="tok&amp;en" />
        <input type="hidden" name="ReturnUrl" value="/connect/authorize?x=1&amp;y=2">
        <input name='UserName' value=''>
        <input name=IsTemporaryLogin value=False>
        <input type="submit">
      </form>
    </body></html>`;
  const form = parseLoginForm(html);
  assert.ok(form);
  assert.equal(form.action, "/account/login?ReturnUrl=%2Fconnect%2Fauthorize");
  assert.equal(form.fields.__RequestVerificationToken, "tok&en");
  assert.equal(form.fields.ReturnUrl, "/connect/authorize?x=1&y=2");
  assert.equal(form.fields.UserName, "");
  assert.equal(form.fields.IsTemporaryLogin, "False");
});

test("a page with no POST form yields null rather than a silent bad POST", () => {
  assert.equal(parseLoginForm("<html><body><p>karbantartás</p></body></html>"), null);
  assert.equal(parseLoginForm('<form method="post"><input name="a"></form>'), null);
});

test("a trial connection never refreshes after its initial access token expires", async () => {
  let requests = 0;
  const client = new KretaClient({
    instituteCode: "klik123456",
    refreshToken: "trial-refresh",
    accessToken: "trial-access",
    accessExpiresAt: Date.now() - 1,
    allowRefresh: false,
    fetchImpl: async () => {
      requests += 1;
      return new Response("{}");
    },
  });
  await assert.rejects(() => client.getJson("sajat/TanuloAdatlap"), /30 perces próbakapcsolat lejárt/);
  assert.equal(requests, 0);
});

test("a keep-alive refresh is reserved before rotation and persisted before the API call", async () => {
  const events: string[] = [];
  const client = new KretaClient({
    instituteCode: "klik123456",
    refreshToken: "old-refresh",
    accessToken: "old-access",
    accessExpiresAt: Date.now() + 30_000,
    allowRefresh: true,
    onBeforeRefresh: () => { events.push("claim"); },
    onRefresh: (tokens) => { events.push(`persist:${tokens.refreshToken}`); },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/connect/token")) {
        events.push("refresh");
        return new Response(JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 1800,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      events.push("api");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.deepEqual(await client.getJson("sajat/TanuloAdatlap"), { ok: true });
  assert.deepEqual(events, ["claim", "refresh", "persist:new-refresh", "api"]);
});

test("the replay cache allows one claim per id", () => {
  const cache = new ReplayCache(1000);
  assert.ok(cache.claim("code-1"));
  assert.equal(cache.claim("code-1"), false);
  assert.ok(cache.claim("code-2"));
});

test("the replay cache forgets ids once they could no longer be replayed", () => {
  const cache = new ReplayCache(1000);
  assert.ok(cache.claim("code-1", 0));
  assert.equal(cache.claim("code-1", 500), false);
  assert.ok(cache.claim("code-1", 2000));
});

test("list answers are capped and report truncation", () => {
  const packed = pack([1, 2, 3, 4], 2) as { items: unknown[]; returned: number; total: number; truncated: boolean };
  assert.deepEqual(packed.items, [1, 2]);
  assert.equal(packed.returned, 2);
  assert.equal(packed.total, 4);
  assert.equal(packed.truncated, true);
  assert.deepEqual(pack({ a: 1 }), { data: { a: 1 } });
});

test("limits outside the allowed band are refused", () => {
  assert.equal(validateLimit(1), 1);
  for (const bad of [0, -1, 501, 1.5]) {
    assert.throws(() => validateLimit(bad), ToolError);
  }
});

test("date ranges default around today and validate explicit input", () => {
  const today = new Date("2026-09-03T00:00:00Z");
  assert.deepEqual(dateRange(undefined, undefined, { defaultStartDays: -7, defaultEndDays: 14, today }), {
    start: "2026-08-27",
    end: "2026-09-17",
  });
  assert.deepEqual(dateRange("2026-09-01", "2026-09-02", { defaultStartDays: 0, today }), {
    start: "2026-09-01",
    end: "2026-09-02",
  });
  assert.throws(() => dateRange("2026-09-02", "2026-09-01", { defaultStartDays: 0, today }), ToolError);
  assert.throws(() => dateRange("2026/09/01", undefined, { defaultStartDays: 0, today }), ToolError);
  assert.throws(() => dateRange("2026-01-01", "2026-12-31", { defaultStartDays: 0, today }), ToolError);
});

test("study task uids are de-duplicated and stripped of trailing parts", () => {
  assert.deepEqual(
    studyTaskUids([
      { OktatasNevelesiFeladat: { Uid: "111,Altalanos" } },
      { OktatasNevelesiFeladat: { Uid: "111,Masik" } },
      { OktatasNevelesiFeladat: { uid: "222" } },
      { nothing: true },
      "junk",
    ]),
    ["111", "222"],
  );
  assert.deepEqual(studyTaskUids(null), []);
});
