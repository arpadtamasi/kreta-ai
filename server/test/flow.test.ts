/**
 * End-to-end: dynamic registration → Google-backed /authorize → /token →
 * an MCP tool call backed by encrypted child-profile credentials.
 *
 * The client-facing OAuth artifacts carry profile references, never KRÉTA
 * credentials. The encrypted credential stays in the parent-owned store.
 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createConnection } from "../src/profiles/connection.js";
import { createClassroomConnection } from "../src/classroom/connection.js";
import type { ChildConnection, ChildProfile, ChildProfileInput, ChildProfileStore, ClassroomConnection } from "../src/profiles/store.js";
import type { Sealer } from "../src/seal.js";

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const SEALING_KEY = randomBytes(32).toString("base64");

class MemoryChildProfileStore implements ChildProfileStore {
  readonly profiles: ChildProfile[];
  readonly classroomOnlyProfile: ChildProfile;

  constructor(sealer: Sealer) {
    const tokens = (suffix: string) => ({
      accessToken: "kreta-access",
      refreshToken: `kreta-refresh-${suffix}`,
      expiresIn: 300,
      rotated: false,
    });
    this.profiles = [
      {
        id: "profile-lilla",
        childName: "Lilla",
        normalizedName: "lilla",
        kretaUsername: "lilla-diak",
        instituteCode: "klik123456",
        connection: createConnection(sealer, tokens("lilla-diak"), "keep_alive"),
        classroomConnection: createClassroomConnection(
          sealer,
          "classroom-refresh-lilla",
          "lilla@iskola.example",
          ["https://www.googleapis.com/auth/classroom.courses.readonly"],
          86_400,
        ),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: "profile-kata",
        childName: "Kata",
        normalizedName: "kata",
        kretaUsername: "kata-diak",
        instituteCode: "klik999999",
        connection: createConnection(sealer, tokens("kata-diak"), "keep_alive"),
        classroomConnection: createClassroomConnection(
          sealer,
          "classroom-refresh-kata",
          "kata@iskola.example",
          ["https://www.googleapis.com/auth/classroom.courses.readonly"],
          86_400,
        ),
        createdAt: new Date(1).toISOString(),
        updatedAt: new Date(1).toISOString(),
      },
    ];
    this.classroomOnlyProfile = {
      id: "profile-aron",
      childName: "Áron",
      normalizedName: "áron",
      kretaUsername: "aron-diak",
      instituteCode: "klik777777",
      classroomConnection: createClassroomConnection(
        sealer,
        "classroom-refresh-aron",
        "aron@iskola.example",
        ["https://www.googleapis.com/auth/classroom.courses.readonly"],
        86_400,
      ),
      createdAt: new Date(2).toISOString(),
      updatedAt: new Date(2).toISOString(),
    };
  }

  async list(uid: string) {
    if (uid === "parent-uid") return this.profiles;
    return uid === "classroom-only-uid" ? [this.classroomOnlyProfile] : [];
  }

  async get(uid: string, id: string) {
    if (uid === "parent-uid") return this.profiles.find((profile) => profile.id === id);
    return uid === "classroom-only-uid" && id === this.classroomOnlyProfile.id
      ? this.classroomOnlyProfile
      : undefined;
  }

  async save(_uid: string, input: ChildProfileInput & { id?: string }, connection?: ChildConnection) {
    const profile: ChildProfile = {
      ...input,
      id: input.id ?? "profile-new",
      ...(connection ? { connection } : {}),
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
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
    return this.profiles
      .filter((profile) => {
        const nextActionAt = profile.connection?.mode === "keep_alive"
          ? profile.connection.nextRefreshAt
          : profile.connection?.expiresAt;
        return nextActionAt ? Date.parse(nextActionAt) <= now.valueOf() : false;
      })
      .slice(0, limit)
      .map((profile) => ({ uid: "parent-uid", profile }));
  }

  async delete() {
    return false;
  }
}

const classroomRequests: Array<{ url: string; method: string; authorization: string }> = [];

/** Stands in for the KRÉTA/Google token endpoints and their read-only student APIs. */
const stubFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://oauth2.googleapis.com/token") {
    const body = String(init?.body ?? "");
    const refreshToken = new URLSearchParams(body).get("refresh_token") ?? "unknown";
    return new Response(JSON.stringify({
      access_token: refreshToken.replace("refresh", "access"),
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/classroom.courses.readonly",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("https://classroom.googleapis.com/v1/courses")) {
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    classroomRequests.push({ url, method: init?.method ?? "GET", authorization });
    const child = authorization.includes("lilla") ? "Lilla" : authorization.includes("kata") ? "Kata" : "ismeretlen";
    return new Response(JSON.stringify({ courses: [{ id: `course-${child.toLowerCase()}`, name: `${child} matematika` }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.startsWith("https://idp.e-kreta.hu/connect/token")) {
    return new Response(
      JSON.stringify({ access_token: "kreta-access", refresh_token: "kreta-refresh-lilla-diak", expires_in: 300 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (url.includes("/ellenorzo/v3/sajat/HaziFeladatok")) {
    return new Response(JSON.stringify([{ Uid: "hf-1", Szoveg: "Matek 12. oldal" }, { Uid: "hf-2" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
};

const config = loadConfig({
  TOKEN_SEALING_KEY: SEALING_KEY,
  OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
  GOOGLE_CLASSROOM_CLIENT_ID: "classroom-client",
  GOOGLE_CLASSROOM_CLIENT_SECRET: "classroom-secret",
} as NodeJS.ProcessEnv);
const profileStore = new MemoryChildProfileStore(config.sealer);

const server = createApp({
  config,
  fetchImpl: stubFetch,
  childProfileStore: profileStore,
  verifyFirebaseSessionCookie: async (cookie) => {
    if (cookie === "parent-session") return { uid: "parent-uid", name: "Anna Példa" };
    if (cookie === "other-session") return { uid: "other-uid", name: "Másik Szülő" };
    if (cookie === "classroom-only-session") return { uid: "classroom-only-uid", name: "Classroom Szülő" };
    throw new Error("invalid session");
  },
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => void server.close());

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier, "ascii").digest("base64url") };
}

async function register(): Promise<{ clientId: string; clientSecret: string }> {
  const response = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: "Claude" }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { client_id: string; client_secret: string };
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

async function authorize(
  clientId: string,
  challenge: string,
  state: string,
  cookie = "parent-session",
): Promise<Response> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  const consent = await fetch(`${base}/authorize?${query}`, {
    headers: { cookie: `__session=${cookie}` },
    redirect: "manual",
  });
  if (consent.status !== 200) return consent;
  const html = await consent.text();
  const authorizationRequest = /name="authorization_request" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(authorizationRequest, "the consent page must carry a sealed authorization request");
  return fetch(`${base}/authorize`, {
    method: "POST",
    headers: {
      cookie: `__session=${cookie}`,
      origin: base,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ authorization_request: authorizationRequest, decision: "approve" }),
    redirect: "manual",
  });
}

async function redeem(
  code: string,
  clientId: string,
  clientSecret: string,
  verifier: string,
): Promise<Response> {
  return fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    }).toString(),
  });
}

/** Drives one JSON-RPC call over the streamable-HTTP transport. */
async function callMcp(accessToken: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  // The transport answers as SSE; take the first data frame.
  const data = /^data: (.+)$/m.exec(text);
  return JSON.parse(data ? data[1]! : text) as Record<string, unknown>;
}

/** Runs the whole happy path and returns everything the assertions need. */
async function connect() {
  const { clientId, clientSecret } = await register();
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString("hex");
  const redirected = await authorize(clientId, challenge, state);
  assert.equal(redirected.status, 302);
  const location = new URL(redirected.headers.get("location")!);
  assert.equal(location.origin + location.pathname, REDIRECT_URI);
  assert.equal(location.searchParams.get("state"), state);
  const code = location.searchParams.get("code")!;
  assert.ok(code);

  const tokenResponse = await redeem(code, clientId, clientSecret, verifier);
  assert.equal(tokenResponse.status, 200);
  const token = (await tokenResponse.json()) as { access_token: string; token_type: string };
  assert.equal(token.token_type, "Bearer");
  return { clientId, clientSecret, verifier, code, accessToken: token.access_token };
}

test("discovery advertises the endpoints an MCP client needs", async () => {
  const metadata = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
  assert.equal(metadata.authorization_endpoint, `${base}/authorize`);
  assert.equal(metadata.token_endpoint, `${base}/token`);
  assert.equal(metadata.registration_endpoint, `${base}/register`);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);

  const resource = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
  assert.deepEqual(resource.authorization_servers, [base]);
});

test("registration refuses a redirect_uri the deployment does not allow", async () => {
  const response = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["https://evil.example/callback"] }),
  });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error: string }).error, "invalid_redirect_uri");
});

test("/authorize refuses a client id this server did not issue", async () => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: "made-up",
    redirect_uri: REDIRECT_URI,
    code_challenge: pkce().challenge,
    code_challenge_method: "S256",
  });
  assert.equal((await fetch(`${base}/authorize?${query}`, { redirect: "manual" })).status, 401);
});

test("/authorize requires PKCE, reporting the error to the client", async () => {
  const { clientId } = await register();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    state: "st",
  });
  const response = await fetch(`${base}/authorize?${query}`, { redirect: "manual" });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.searchParams.get("error"), "invalid_request");
  assert.equal(location.searchParams.get("state"), "st");
});

test("/authorize identifies the parent with Google, then returns a code without KRÉTA fields", async () => {
  const { clientId } = await register();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: pkce().challenge,
    code_challenge_method: "S256",
    state: "st",
  });
  const withoutSession = await fetch(`${base}/authorize?${query}`, { redirect: "manual" });
  assert.equal(withoutSession.status, 302);
  assert.match(withoutSession.headers.get("location") ?? "", /^\/\?return_to=/);

  const withSession = await fetch(`${base}/authorize?${query}`, {
    headers: { cookie: "__session=parent-session" },
    redirect: "manual",
  });
  assert.equal(withSession.status, 200);
  const consent = await withSession.text();
  assert.match(consent, /Igen, kapcsolódhat/);
  assert.match(consent, /Lilla/);
  assert.ok(!consent.includes("lilla-diak"));

  const authorizationRequest = /name="authorization_request" value="([^"]+)"/.exec(consent)?.[1];
  assert.ok(authorizationRequest);
  const approved = await fetch(`${base}/authorize`, {
    method: "POST",
    headers: {
      cookie: "__session=parent-session",
      origin: base,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ authorization_request: authorizationRequest, decision: "approve" }),
    redirect: "manual",
  });
  assert.equal(approved.status, 302);
  const location = new URL(approved.headers.get("location")!);
  assert.equal(location.origin + location.pathname, REDIRECT_URI);
  assert.ok(location.searchParams.get("code"));
  assert.equal(location.searchParams.get("state"), "st");
});

test("/authorize requires an explicit same-origin confirmation", async () => {
  const { clientId } = await register();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: pkce().challenge,
    code_challenge_method: "S256",
    state: "csrf",
  });
  const consent = await fetch(`${base}/authorize?${query}`, {
    headers: { cookie: "__session=parent-session" },
  });
  assert.equal(consent.status, 200);
  const authorizationRequest = /name="authorization_request" value="([^"]+)"/.exec(await consent.text())?.[1];
  assert.ok(authorizationRequest);

  const crossOrigin = await fetch(`${base}/authorize`, {
    method: "POST",
    headers: {
      cookie: "__session=parent-session",
      origin: "https://evil.example",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ authorization_request: authorizationRequest, decision: "approve" }),
    redirect: "manual",
  });
  assert.equal(crossOrigin.status, 403);

  const approved = await fetch(`${base}/authorize`, {
    method: "POST",
    headers: {
      cookie: "__session=parent-session",
      origin: base,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ authorization_request: authorizationRequest, decision: "approve" }),
    redirect: "manual",
  });
  assert.equal(approved.status, 302);
  assert.ok(new URL(approved.headers.get("location")!).searchParams.get("code"));
});

test("a Google account without online children returns to profile setup", async () => {
  const { clientId } = await register();
  const response = await authorize(clientId, pkce().challenge, "st", "other-session");
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /^\/\?return_to=/);
});

test("a Classroom-only child is enough to authorize the Claude connector", async () => {
  const { clientId } = await register();
  const response = await authorize(clientId, pkce().challenge, "st", "classroom-only-session");
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")!).origin + new URL(response.headers.get("location")!).pathname, REDIRECT_URI);
});

test("the connected session reaches the MCP tools and answers KRÉTA data", async () => {
  const { accessToken } = await connect();

  const listed = (await callMcp(accessToken, { jsonrpc: "2.0", id: 1, method: "tools/list" })) as {
    result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
  };
  const names = listed.result.tools.map((entry) => entry.name);
  assert.ok(names.includes("kreta_homework"));
  assert.ok(names.includes("kreta_login"));
  assert.equal(names.length, 25);
  assert.ok(
    listed.result.tools.every((entry) => entry.annotations?.readOnlyHint === true),
    "every tool must be annotated read-only",
  );

  const called = (await callMcp(accessToken, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "kreta_homework",
      arguments: { child: "Lilla", start_date: "2026-09-01", end_date: "2026-09-07" },
    },
  })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  assert.notEqual(called.result.isError, true);
  const payload = JSON.parse(called.result.content[0]!.text) as { total: number; items: Array<{ Uid: string }> };
  assert.equal(payload.total, 2);
  assert.equal(payload.items[0]!.Uid, "hf-1");
});

test("Classroom tools use the selected child's separate Google account", async () => {
  classroomRequests.length = 0;
  const { accessToken } = await connect();

  for (const [child, expectedCourse] of [["Lilla", "Lilla matematika"], ["Kata", "Kata matematika"]] as const) {
    const called = (await callMcp(accessToken, {
      jsonrpc: "2.0",
      id: child,
      method: "tools/call",
      params: { name: "classroom_courses", arguments: { child } },
    })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    assert.notEqual(called.result.isError, true);
    const payload = JSON.parse(called.result.content[0]!.text) as { items: Array<{ name: string }> };
    assert.equal(payload.items[0]!.name, expectedCourse);
  }
  assert.equal(classroomRequests.length, 2);
  assert.ok(classroomRequests.every((request) => request.method === "GET"));
  assert.ok(classroomRequests.every((request) => new URL(request.url).searchParams.has("fields")));
  assert.match(classroomRequests[0]!.authorization, /classroom-access-lilla/);
  assert.match(classroomRequests[1]!.authorization, /classroom-access-kata/);
});

test("client-facing OAuth artifacts contain profile references, never KRÉTA credentials", async () => {
  const { code, accessToken } = await connect();
  const authorization = config.sealer.open<{ session: { children: Array<Record<string, unknown>> } }>("code", code);
  const session = config.sealer.open<{ children: Array<Record<string, unknown>> }>("access", accessToken);

  for (const child of [...authorization.session.children, ...session.children]) {
    assert.deepEqual(Object.keys(child).sort(), ["instituteCode", "label", "profileId"]);
  }

  for (const [what, token] of [["code", code], ["access token", accessToken]] as const) {
    const decoded = Buffer.from(token.split(".")[2]!, "base64url").toString("latin1");
    assert.ok(!decoded.includes("kreta-access"), `the ${what} must not expose the access token`);
    assert.ok(!decoded.includes("kreta-refresh"), `the ${what} must not expose the refresh token`);
  }
});

test("a code cannot be redeemed with another client's secret", async () => {
  const { clientId, clientSecret } = await register();
  const { verifier, challenge } = pkce();
  const redirected = await authorize(clientId, challenge, "st");
  const code = new URL(redirected.headers.get("location")!).searchParams.get("code")!;

  const foreignSecret = (await register()).clientSecret;
  assert.equal((await redeem(code, clientId, foreignSecret, verifier)).status, 401);
  // The rejected attempt must not have consumed the code.
  assert.equal((await redeem(code, clientId, clientSecret, verifier)).status, 200);
});

test("PKCE and replay protection hold at /token", async () => {
  const { clientId, clientSecret } = await register();
  const { verifier, challenge } = pkce();
  const redirected = await authorize(clientId, challenge, "st");
  const code = new URL(redirected.headers.get("location")!).searchParams.get("code")!;

  const wrongVerifier = await redeem(code, clientId, clientSecret, pkce().verifier);
  assert.equal(wrongVerifier.status, 400);
  assert.equal(((await wrongVerifier.json()) as { error_description: string }).error_description, "PKCE verification failed");

  assert.equal((await redeem(code, clientId, clientSecret, verifier)).status, 200);
  const replayed = await redeem(code, clientId, clientSecret, verifier);
  assert.equal(replayed.status, 400);
  assert.match(((await replayed.json()) as { error_description: string }).error_description, /already been redeemed/);
});

test("/mcp refuses a missing, forged or foreign token", async () => {
  const noToken = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(noToken.status, 401);
  assert.match(noToken.headers.get("www-authenticate") ?? "", /resource_metadata=/);

  const forged = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(forged.status, 401);
});

test("several connected children are addressed by name", async () => {
  const { accessToken } = await connect();

  const ambiguous = (await callMcp(accessToken, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "kreta_evaluations", arguments: {} },
  })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  assert.equal(ambiguous.result.isError, true);
  assert.match(ambiguous.result.content[0]!.text, /Lilla, Kata/);

  const named = (await callMcp(accessToken, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "kreta_login", arguments: { child: "kata" } },
  })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  assert.notEqual(named.result.isError, true);
  const status = JSON.parse(named.result.content[0]!.text) as {
    label: string;
    institution: string;
    password_stored: boolean;
    children: string[];
  };
  assert.equal(status.label, "Kata");
  assert.equal(status.institution, "klik999999");
  assert.equal(status.password_stored, false);
  assert.deepEqual(status.children, ["Lilla", "Kata"]);

  const unknown = (await callMcp(accessToken, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "kreta_evaluations", arguments: { child: "Áron" } },
  })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0]!.text, /Nincs "Áron" nevű/);
});
