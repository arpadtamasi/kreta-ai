import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { ChildProfile, ChildProfileInput, ChildProfileStore } from "../src/profiles/store.js";

class MemoryChildProfileStore implements ChildProfileStore {
  readonly byUser = new Map<string, ChildProfile[]>();
  nextId = 1;

  async list(uid: string) {
    return [...(this.byUser.get(uid) ?? [])];
  }

  async save(uid: string, input: ChildProfileInput & { id?: string }) {
    const profiles = this.byUser.get(uid) ?? [];
    const previous = input.id ? profiles.find((profile) => profile.id === input.id) : undefined;
    const now = new Date(1_800_000_000_000 + this.nextId).toISOString();
    const profile: ChildProfile = {
      ...input,
      id: input.id ?? `profile-${String(this.nextId++).padStart(4, "0")}`,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.byUser.set(uid, [...profiles.filter((item) => item.id !== profile.id), profile]);
    return profile;
  }

  async delete(uid: string, id: string) {
    const profiles = this.byUser.get(uid) ?? [];
    const remaining = profiles.filter((profile) => profile.id !== id);
    this.byUser.set(uid, remaining);
    return remaining.length !== profiles.length;
  }
}

const store = new MemoryChildProfileStore();
const config = loadConfig({ TOKEN_SEALING_KEY: randomBytes(32).toString("base64") } as NodeJS.ProcessEnv);
const server = createApp({
  config,
  childProfileStore: store,
  verifyFirebaseIdToken: async (token) => {
    if (token === "anna-token") return { uid: "anna-uid", name: "Anna Példa" };
    throw new Error("invalid token");
  },
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => void server.close());

function profileRequest(body: Record<string, unknown>) {
  return fetch(`${base}/api/profiles`, {
    method: "PUT",
    headers: { authorization: "Bearer anna-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("child profiles require a verified Google identity", async () => {
  assert.equal((await fetch(`${base}/api/profiles`)).status, 401);
  assert.equal(
    (await fetch(`${base}/api/profiles`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })).status,
    401,
  );
});

test("a parent saves and reads the non-password KRÉTA profile", async () => {
  const saved = await profileRequest({
    childName: "  Lilla  ",
    kretaUsername: "lilla-diak",
    instituteCode: "https://klik123456.e-kreta.hu",
  });
  assert.equal(saved.status, 200);
  const profile = ((await saved.json()) as { profile: ChildProfile }).profile;
  assert.equal(profile.childName, "Lilla");
  assert.equal(profile.instituteCode, "klik123456");
  assert.equal("password" in profile, false);

  const listed = await fetch(`${base}/api/profiles`, { headers: { authorization: "Bearer anna-token" } });
  assert.equal(listed.status, 200);
  const body = (await listed.json()) as { profiles: ChildProfile[] };
  assert.deepEqual(body.profiles.map((item) => item.childName), ["Lilla"]);
  assert.equal("password" in body.profiles[0]!, false);
});

test("names are unique within one Google account and profiles are editable", async () => {
  const duplicate = await profileRequest({
    childName: "lilla",
    kretaUsername: "masik-user",
    instituteCode: "klik999999",
  });
  assert.equal(duplicate.status, 409);

  const existing = (await store.list("anna-uid"))[0]!;
  const updated = await profileRequest({
    id: existing.id,
    childName: "Lilla Példa",
    kretaUsername: "uj-user",
    instituteCode: "klik654321",
  });
  assert.equal(updated.status, 200);
  assert.equal(((await updated.json()) as { profile: ChildProfile }).profile.kretaUsername, "uj-user");
});

test("at most three child profiles can be saved and the owner can delete one", async () => {
  for (const [childName, code] of [["Kata", "klik2"], ["Áron", "klik3"]]) {
    assert.equal((await profileRequest({ childName, kretaUsername: `${childName}-user`, instituteCode: code })).status, 200);
  }
  assert.equal(
    (await profileRequest({ childName: "Zsófi", kretaUsername: "zsofi-user", instituteCode: "klik4" })).status,
    409,
  );

  const target = (await store.list("anna-uid"))[0]!;
  const deleted = await fetch(`${base}/api/profiles/${target.id}`, {
    method: "DELETE",
    headers: { authorization: "Bearer anna-token" },
  });
  assert.equal(deleted.status, 204);
  assert.equal((await store.list("anna-uid")).length, 2);
});
