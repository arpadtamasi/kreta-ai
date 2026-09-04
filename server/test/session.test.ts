import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig({ TOKEN_SEALING_KEY: randomBytes(32).toString("base64") } as NodeJS.ProcessEnv);
const server = createApp({
  config,
  createFirebaseSessionCookie: async (idToken, expiresInMs) => {
    assert.equal(expiresInMs, 5 * 24 * 60 * 60 * 1000);
    if (idToken !== "fresh-google-token") throw new Error("invalid token");
    return "firebase-session-cookie";
  },
  verifyFirebaseSessionCookie: async (cookie) => {
    if (cookie === "firebase-session-cookie") return { uid: "anna-uid", name: "Anna Példa" };
    throw new Error("invalid cookie");
  },
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => void server.close());

test("a fresh Google token becomes an HttpOnly same-site session", async () => {
  const response = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ idToken: "fresh-google-token" }),
  });
  assert.equal(response.status, 204);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^__session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test("the session endpoint rejects cross-origin login CSRF", async () => {
  const response = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ idToken: "fresh-google-token" }),
  });
  assert.equal(response.status, 403);
});

test("a valid session can be checked and cleared", async () => {
  const checked = await fetch(`${base}/api/session`, { headers: { cookie: "__session=firebase-session-cookie" } });
  assert.equal(checked.status, 200);
  assert.deepEqual(await checked.json(), { signedIn: true, name: "Anna Példa" });

  const cleared = await fetch(`${base}/api/session`, { method: "DELETE" });
  assert.equal(cleared.status, 204);
  assert.match(cleared.headers.get("set-cookie") ?? "", /Max-Age=0/);
});
