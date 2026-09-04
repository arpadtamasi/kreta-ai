import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { CLASSROOM_SCOPES } from "../src/classroom/auth.js";
import { openClassroomCredential } from "../src/classroom/connection.js";
import { loadConfig } from "../src/config.js";
import type {
  ChildConnection,
  ChildProfile,
  ChildProfileInput,
  ChildProfileStore,
  ClassroomConnection,
} from "../src/profiles/store.js";

class MemoryStore implements ChildProfileStore {
  readonly profiles: ChildProfile[] = [
    {
      id: "profile-lilla",
      childName: "Lilla",
      normalizedName: "lilla",
      kretaUsername: "lilla-user",
      instituteCode: "klik1",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "profile-kata",
      childName: "Kata",
      normalizedName: "kata",
      kretaUsername: "kata-user",
      instituteCode: "klik2",
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    },
  ];

  async list(uid: string) { return uid === "parent-uid" ? this.profiles : []; }
  async get(uid: string, id: string) {
    return uid === "parent-uid" ? this.profiles.find((profile) => profile.id === id) : undefined;
  }
  async save(_uid: string, input: ChildProfileInput & { id?: string }, connection?: ChildConnection) {
    return { ...input, id: input.id ?? "profile-new", connection, createdAt: "", updatedAt: "" };
  }
  async updateConnection() { return false; }
  async clearConnection() { return false; }
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
  async listDueConnections() { return []; }
  async delete() { return false; }
}

const store = new MemoryStore();
const revoked: string[] = [];
const config = loadConfig({
  TOKEN_SEALING_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CLASSROOM_CLIENT_ID: "web-client.apps.googleusercontent.com",
  GOOGLE_CLASSROOM_CLIENT_SECRET: "server-only-secret",
} as NodeJS.ProcessEnv);

const googleFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://oauth2.googleapis.com/token") {
    const body = new URLSearchParams(String(init?.body ?? ""));
    const code = body.get("code") ?? "unknown";
    assert.ok(body.get("code_verifier"), "the callback must use PKCE");
    assert.equal(body.get("client_secret"), "server-only-secret");
    return new Response(JSON.stringify({
      access_token: `access-${code}`,
      refresh_token: `refresh-${code}`,
      expires_in: 3600,
      scope: CLASSROOM_SCOPES.join(" "),
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
    const access = new Headers(init?.headers).get("authorization")?.replace("Bearer access-", "") ?? "unknown";
    return new Response(JSON.stringify({ email: `${access}@iskola.example`, email_verified: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "https://oauth2.googleapis.com/revoke") {
    revoked.push(new URLSearchParams(String(init?.body ?? "")).get("token") ?? "");
    return new Response("", { status: 200 });
  }
  return new Response("not found", { status: 404 });
};

const server = createApp({
  config,
  childProfileStore: store,
  fetchImpl: googleFetch,
  verifyFirebaseIdToken: async (token) => {
    if (token === "parent-token") return { uid: "parent-uid", name: "Szülő" };
    if (token === "other-token") return { uid: "other-uid", name: "Más" };
    throw new Error("invalid token");
  },
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => void server.close());

async function begin(profileId: string, token = "parent-token", returnTo = ""): Promise<URL> {
  const response = await fetch(`${base}/api/classroom/authorize`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ profileId, ...(returnTo ? { returnTo } : {}) }),
  });
  assert.equal(response.status, 200);
  const data = await response.json() as { authorizationUrl: string };
  return new URL(data.authorizationUrl);
}

async function finish(authorizationUrl: URL, code: string): Promise<Response> {
  const callback = new URL("/api/classroom/callback", base);
  callback.searchParams.set("state", authorizationUrl.searchParams.get("state")!);
  callback.searchParams.set("code", code);
  return fetch(callback, { redirect: "manual" });
}

test("Classroom authorization is parent-authenticated, read-only and uses a web callback with PKCE", async () => {
  assert.equal((await fetch(`${base}/api/classroom/authorize`, { method: "POST" })).status, 401);
  const foreign = await fetch(`${base}/api/classroom/authorize`, {
    method: "POST",
    headers: { authorization: "Bearer other-token", "content-type": "application/json" },
    body: JSON.stringify({ profileId: "profile-lilla" }),
  });
  assert.equal(foreign.status, 404);

  const authorization = await begin("profile-lilla");
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("redirect_uri"), `${base}/api/classroom/callback`);
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.match(authorization.searchParams.get("prompt") ?? "", /select_account/);
  const scopes = new Set((authorization.searchParams.get("scope") ?? "").split(" "));
  assert.ok(CLASSROOM_SCOPES.every((scope) => scopes.has(scope)));
  assert.ok([...scopes].filter((scope) => scope.includes("/auth/classroom.")).every((scope) => scope.endsWith(".readonly")));
  assert.equal(authorization.searchParams.get("include_granted_scopes"), "false");
  assert.ok(!authorization.toString().includes("server-only-secret"));
});

test("Classroom OAuth configuration cannot be deployed half-configured", () => {
  assert.throws(() => loadConfig({
    TOKEN_SEALING_KEY: randomBytes(32).toString("base64"),
    GOOGLE_CLASSROOM_CLIENT_ID: "id-only",
  } as NodeJS.ProcessEnv), /must be configured together/);
});

test("each child stores a separate encrypted Classroom grant and exposes only connection metadata", async () => {
  for (const [profileId, code] of [["profile-lilla", "lilla"], ["profile-kata", "kata"]] as const) {
    const response = await finish(await begin(profileId), code);
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /classroom=connected/);
  }

  const lilla = await store.get("parent-uid", "profile-lilla");
  const kata = await store.get("parent-uid", "profile-kata");
  assert.ok(lilla?.classroomConnection);
  assert.ok(kata?.classroomConnection);
  assert.notEqual(lilla.classroomConnection.credential, kata.classroomConnection.credential);
  assert.equal(openClassroomCredential(config.sealer, lilla.classroomConnection).refreshToken, "refresh-lilla");
  assert.equal(openClassroomCredential(config.sealer, kata.classroomConnection).refreshToken, "refresh-kata");

  const listed = await fetch(`${base}/api/profiles`, { headers: { authorization: "Bearer parent-token" } });
  const body = await listed.text();
  assert.match(body, /lilla@iskola\.example/);
  assert.match(body, /"classroom":\{"status":"connected"/);
  assert.ok(!body.includes("refresh-lilla"));
  assert.ok(!body.includes("server-only-secret"));
});

test("Classroom state is single-use and tamper resistant", async () => {
  const returnTo = "/authorize?client_id=test&state=parent";
  const authorization = await begin("profile-lilla", "parent-token", returnTo);
  const completed = await finish(authorization, "fresh");
  assert.equal(completed.status, 302);
  assert.equal(new URL(completed.headers.get("location")!).searchParams.get("return_to"), returnTo);
  const replay = await finish(authorization, "second");
  assert.match(replay.headers.get("location") ?? "", /classroom=invalid_state/);

  const tampered = new URL(authorization);
  const state = tampered.searchParams.get("state")!;
  tampered.searchParams.set("state", `${state.slice(0, -1)}x`);
  const result = await finish(tampered, "tampered");
  assert.match(result.headers.get("location") ?? "", /classroom=invalid_state/);
});

test("disconnect revokes and removes only the selected child's Classroom grant", async () => {
  const lilla = await store.get("parent-uid", "profile-lilla");
  assert.ok(lilla?.classroomConnection);
  const response = await fetch(`${base}/api/classroom/profile-lilla/connection`, {
    method: "DELETE",
    headers: { authorization: "Bearer parent-token" },
  });
  assert.equal(response.status, 204);
  assert.equal((await store.get("parent-uid", "profile-lilla"))?.classroomConnection, undefined);
  assert.ok((await store.get("parent-uid", "profile-kata"))?.classroomConnection);
  assert.ok(revoked.includes("refresh-fresh"));
});
