import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Pledge, PledgeStore } from "../src/pledges/store.js";

class MemoryPledgeStore implements PledgeStore {
  readonly data = new Map<string, Pledge>();

  async list(limit: number) {
    const pledges = [...this.data.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
    return { count: this.data.size, pledges };
  }

  async upsert(input: { uid: string; name: string; message: string }) {
    const previous = this.data.get(input.uid);
    const now = new Date(1_800_000_000_000 + this.data.size).toISOString();
    const pledge = { ...input, createdAt: previous?.createdAt ?? now, updatedAt: now };
    this.data.set(input.uid, pledge);
    return pledge;
  }

  async delete(uid: string) {
    return this.data.delete(uid);
  }
}

const store = new MemoryPledgeStore();
const config = loadConfig({ TOKEN_SEALING_KEY: randomBytes(32).toString("base64") } as NodeJS.ProcessEnv);
const server = createApp({
  config,
  pledgeStore: store,
  verifyFirebaseIdToken: async (token) => {
    if (token === "anna-token") return { uid: "anna-uid", name: "Anna Példa" };
    throw new Error("invalid token");
  },
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => void server.close());

test("the pledge list requires a verified Google identity", async () => {
  const anonymous = await fetch(`${base}/api/pledges`);
  assert.equal(anonymous.status, 401);

  const signedIn = await fetch(`${base}/api/pledges`, {
    headers: { authorization: "Bearer anna-token" },
  });
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await signedIn.json(), { count: 0, pledges: [] });
});

test("posting requires a verified Google identity", async () => {
  const response = await fetch(`${base}/api/pledges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Szeretnék normális hozzáférést.", consent: true, website: "" }),
  });
  assert.equal(response.status, 401);
});

test("one verified account creates one public, editable pledge", async () => {
  const first = await fetch(`${base}/api/pledges`, {
    method: "POST",
    headers: { authorization: "Bearer anna-token", "content-type": "application/json" },
    body: JSON.stringify({
      message: "Kérek hivatalos, dokumentált hozzáférést a saját családom adataihoz.",
      consent: true,
      website: "",
    }),
  });
  assert.equal(first.status, 201);
  assert.equal(((await first.json()) as { pledge: { name: string; mine: boolean } }).pledge.name, "Anna Példa");

  const listed = await fetch(`${base}/api/pledges`, { headers: { authorization: "Bearer anna-token" } });
  const body = (await listed.json()) as { count: number; pledges: Array<{ mine: boolean; message: string }> };
  assert.equal(body.count, 1);
  assert.equal(body.pledges[0]?.mine, true);
  assert.match(body.pledges[0]?.message ?? "", /hivatalos/);
});

test("messages reject links and missing publication consent", async () => {
  const withLink = await fetch(`${base}/api/pledges`, {
    method: "POST",
    headers: { authorization: "Bearer anna-token", "content-type": "application/json" },
    body: JSON.stringify({ message: "Nézd meg: https://spam.example", consent: true, website: "" }),
  });
  assert.equal(withLink.status, 400);

  const withoutConsent = await fetch(`${base}/api/pledges`, {
    method: "POST",
    headers: { authorization: "Bearer anna-token", "content-type": "application/json" },
    body: JSON.stringify({ message: "Ez egy megfelelő hosszúságú üzenet.", consent: false, website: "" }),
  });
  assert.equal(withoutConsent.status, 400);
});

test("the signed-in author can remove their pledge", async () => {
  const response = await fetch(`${base}/api/pledges/me`, {
    method: "DELETE",
    headers: { authorization: "Bearer anna-token" },
  });
  assert.equal(response.status, 204);
  assert.equal(store.data.size, 0);
});
