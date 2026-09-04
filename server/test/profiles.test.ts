import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { ChildConnection, ChildProfile, ChildProfileInput, ChildProfileStore, ClassroomConnection } from "../src/profiles/store.js";

interface PublicProfile {
  id: string;
  childName: string;
  kretaUsername: string;
  instituteCode: string;
  connection: {
    status: "disconnected" | "expired" | "active" | "attention";
    keepAlive: boolean;
    connectedAt: string | null;
    refreshedAt: string | null;
    expiresAt: string | null;
    keepAliveUntil: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

class MemoryChildProfileStore implements ChildProfileStore {
  readonly byUser = new Map<string, ChildProfile[]>();
  nextId = 1;

  async list(uid: string) {
    return [...(this.byUser.get(uid) ?? [])];
  }

  async get(uid: string, id: string) {
    return (this.byUser.get(uid) ?? []).find((profile) => profile.id === id);
  }

  async save(uid: string, input: ChildProfileInput & { id?: string }, connection?: ChildConnection) {
    const profiles = this.byUser.get(uid) ?? [];
    const previous = input.id ? profiles.find((profile) => profile.id === input.id) : undefined;
    const now = new Date(1_800_000_000_000 + this.nextId).toISOString();
    const profile: ChildProfile = {
      ...input,
      id: input.id ?? `profile-${String(this.nextId++).padStart(4, "0")}`,
      ...(connection ? { connection } : previous?.connection ? { connection: previous.connection } : {}),
      ...(previous?.classroomConnection ? { classroomConnection: previous.classroomConnection } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.byUser.set(uid, [...profiles.filter((item) => item.id !== profile.id), profile]);
    return profile;
  }

  async updateConnection(uid: string, id: string, expectedVersion: number, connection: ChildConnection) {
    const profile = await this.get(uid, id);
    if (!profile?.connection || profile.connection.version !== expectedVersion) return false;
    profile.connection = connection;
    return true;
  }

  async clearConnection(uid: string, id: string) {
    const profile = await this.get(uid, id);
    if (!profile) return false;
    delete profile.connection;
    return true;
  }

  async setClassroomConnection(uid: string, id: string, connection: ClassroomConnection) {
    const profile = await this.get(uid, id);
    if (!profile) return false;
    profile.classroomConnection = connection;
    return true;
  }

  async clearClassroomConnection(uid: string, id: string) {
    const profile = await this.get(uid, id);
    if (!profile) return false;
    delete profile.classroomConnection;
    return true;
  }

  async listDueConnections(now: Date, limit: number) {
    const due: Array<{ uid: string; profile: ChildProfile }> = [];
    for (const [uid, profiles] of this.byUser) {
      for (const profile of profiles) {
        const nextActionAt = profile.connection?.mode === "keep_alive"
          ? profile.connection.nextRefreshAt
          : profile.connection?.expiresAt;
        if (profile.connection && nextActionAt && Date.parse(nextActionAt) <= now.valueOf()) {
          due.push({ uid, profile });
        }
      }
    }
    return due.slice(0, limit);
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
let loginAttempts = 0;
const server = createApp({
  config,
  childProfileStore: store,
  verifyFirebaseIdToken: async (token) => {
    if (token === "anna-token") return { uid: "anna-uid", name: "Anna Példa" };
    throw new Error("invalid token");
  },
  loginImpl: async (credentials) => {
    loginAttempts += 1;
    if (credentials.password === "hibas") throw new Error("wrong password");
    return {
      accessToken: "stored-access-token",
      refreshToken: "stored-refresh-token",
      expiresIn: 1800,
      rotated: false,
    };
  },
  fetchImpl: async () => new Response("", { status: 200 }),
  verifyRefreshJob: async (token) => token === "scheduler-token",
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

test("the refresh worker endpoint requires its scheduler OIDC identity", async () => {
  assert.equal((await fetch(`${base}/internal/refresh-connections`, { method: "POST" })).status, 401);
  const authorized = await fetch(`${base}/internal/refresh-connections`, {
    method: "POST",
    headers: { authorization: "Bearer scheduler-token" },
  });
  assert.equal(authorized.status, 200);
  assert.equal(((await authorized.json()) as { due: number }).due, 0);
});

test("a failed KRÉTA login creates neither profile nor connection", async () => {
  const response = await profileRequest({
    childName: "Lilla",
    kretaUsername: "lilla-diak",
    instituteCode: "klik123456",
    password: "hibas",
    keepAlive: true,
  });
  assert.equal(response.status, 400);
  assert.equal((await store.list("anna-uid")).length, 0);
});

test("an invalid keep-alive deadline is rejected before KRÉTA login", async () => {
  const attemptsBefore = loginAttempts;
  const response = await profileRequest({
    childName: "Lilla",
    kretaUsername: "lilla-diak",
    instituteCode: "klik123456",
    password: "helyes",
    keepAlive: true,
    keepAliveUntil: "2020-01-01T23:59:59+01:00",
  });
  assert.equal(response.status, 400);
  assert.equal(loginAttempts, attemptsBefore);
});

test("a parent saves and reads the non-password KRÉTA profile", async () => {
  const saved = await profileRequest({
    childName: "  Lilla  ",
    kretaUsername: "lilla-diak",
    instituteCode: "https://klik123456.e-kreta.hu",
    password: "csak-a-belepeshez",
    keepAlive: false,
  });
  assert.equal(saved.status, 200);
  const profile = ((await saved.json()) as { profile: PublicProfile }).profile;
  assert.equal(profile.childName, "Lilla");
  assert.equal(profile.instituteCode, "klik123456");
  assert.equal("password" in profile, false);
  assert.equal(profile.connection.status, "active");
  assert.equal(profile.connection.keepAlive, false);
  assert.ok(!JSON.stringify(profile).includes("stored-refresh-token"));

  const listed = await fetch(`${base}/api/profiles`, { headers: { authorization: "Bearer anna-token" } });
  assert.equal(listed.status, 200);
  const body = (await listed.json()) as { profiles: PublicProfile[] };
  assert.deepEqual(body.profiles.map((item) => item.childName), ["Lilla"]);
  assert.equal("password" in body.profiles[0]!, false);
  assert.ok(!JSON.stringify(body).includes("stored-refresh-token"));
});

test("names are unique within one Google account and profiles are editable", async () => {
  const duplicate = await profileRequest({
    childName: "lilla",
    kretaUsername: "masik-user",
    instituteCode: "klik999999",
    password: "csak-a-belepeshez",
    keepAlive: true,
  });
  assert.equal(duplicate.status, 409);

  const existing = (await store.list("anna-uid"))[0]!;
  const updated = await profileRequest({
    id: existing.id,
    childName: "Lilla Példa",
    kretaUsername: "uj-user",
    instituteCode: "klik654321",
    password: "csak-a-belepeshez",
    keepAlive: true,
  });
  assert.equal(updated.status, 200);
  assert.equal(((await updated.json()) as { profile: PublicProfile }).profile.kretaUsername, "uj-user");
});

test("at most three child profiles can be saved and the owner can delete one", async () => {
  for (const [childName, code] of [["Kata", "klik2"], ["Áron", "klik3"]]) {
    assert.equal((await profileRequest({ childName, kretaUsername: `${childName}-user`, instituteCode: code, password: "jelszo", keepAlive: false })).status, 200);
  }
  assert.equal(
    (await profileRequest({ childName: "Zsófi", kretaUsername: "zsofi-user", instituteCode: "klik4", password: "jelszo", keepAlive: false })).status,
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

test("switching Online off removes only the connection", async () => {
  const profile = (await store.list("anna-uid"))[0]!;
  const response = await fetch(`${base}/api/profiles/${profile.id}/connection`, {
    method: "DELETE",
    headers: { authorization: "Bearer anna-token" },
  });
  assert.equal(response.status, 204);
  const keptProfile = await store.get("anna-uid", profile.id);
  assert.ok(keptProfile, "the child profile must remain");
  assert.equal(keptProfile.connection, undefined);
});
