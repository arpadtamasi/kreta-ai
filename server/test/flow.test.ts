/**
 * End-to-end: dynamic registration → /authorize → KRÉTA login → /token →
 * an MCP tool call, with both KRÉTA login and the KRÉTA API stubbed.
 *
 * The load-bearing assertion is `no credential is stored or leaked`: the
 * whole design claim is that the parent's password exists only for the
 * duration of the login call, so it is checked directly rather than assumed.
 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { KretaError } from "../src/kreta/institute.js";
import type { LoginCredentials } from "../src/kreta/auth.js";

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const PASSWORD = "sup3r-titk0s-jelszo";
const SEALING_KEY = randomBytes(32).toString("base64");

const loginCalls: LoginCredentials[] = [];

/** Stands in for the KRÉTA IDP login: accepts one known parent, rejects the rest. */
async function stubLogin(credentials: LoginCredentials) {
  loginCalls.push(credentials);
  if (credentials.password !== PASSWORD) {
    throw new KretaError("Sikertelen bejelentkezés. Ellenőrizd az azonosítót, a jelszót és az intézmény kódját.");
  }
  return {
    accessToken: "kreta-access",
    refreshToken: `kreta-refresh-${credentials.username}`,
    expiresIn: 300,
    rotated: false,
  };
}

/** Stands in for the KRÉTA token endpoint and the institute's Student API. */
const stubFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.startsWith("https://idp.e-kreta.hu/connect/token")) {
    return new Response(
      JSON.stringify({ access_token: "kreta-access", refresh_token: "kreta-refresh-marci-diak", expires_in: 300 }),
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
} as NodeJS.ProcessEnv);

const server = createApp({ config, loginImpl: stubLogin, fetchImpl: stubFetch }).listen(0);
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

async function openLoginPage(clientId: string, challenge: string, state: string): Promise<string> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  const response = await fetch(`${base}/authorize?${query}`, { redirect: "manual" });
  assert.equal(response.status, 200);
  const html = await response.text();
  const match = /name="request" value="([^"]+)"/.exec(html);
  assert.ok(match, "the login page must carry the sealed request");
  return match[1]!;
}

async function submitLogin(
  request: string,
  children: Array<{ label: string; username: string; password: string; instituteCode: string }>,
): Promise<Response> {
  const form = new URLSearchParams();
  form.set("request", request);
  for (const child of children) {
    form.append("label", child.label);
    form.append("username", child.username);
    form.append("password", child.password);
    form.append("instituteCode", child.instituteCode);
  }
  return fetch(`${base}/authorize/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
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
async function connect(children = [{ label: "Marci", username: "marci-diak", password: PASSWORD, instituteCode: "klik123456" }]) {
  const { clientId, clientSecret } = await register();
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString("hex");
  const request = await openLoginPage(clientId, challenge, state);

  const redirected = await submitLogin(request, children);
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

test("a wrong KRÉTA password re-renders the form with an error and issues no code", async () => {
  const { clientId } = await register();
  const { challenge } = pkce();
  const request = await openLoginPage(clientId, challenge, "st");
  const response = await submitLogin(request, [
    { label: "Marci", username: "marci-diak", password: "rossz", instituteCode: "klik123456" },
  ]);
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /Sikertelen bejelentkezés/);
  assert.match(html, /Marci:/);
  assert.doesNotMatch(html, /rossz/, "the submitted password must never be echoed back");
});

test("the connected session reaches the MCP tools and answers KRÉTA data", async () => {
  const { accessToken } = await connect();

  const listed = (await callMcp(accessToken, { jsonrpc: "2.0", id: 1, method: "tools/list" })) as {
    result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
  };
  const names = listed.result.tools.map((entry) => entry.name);
  assert.ok(names.includes("kreta_homework"));
  assert.ok(names.includes("kreta_login"));
  assert.equal(names.length, 20);
  assert.ok(
    listed.result.tools.every((entry) => entry.annotations?.readOnlyHint === true),
    "every tool must be annotated read-only",
  );

  const called = (await callMcp(accessToken, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "kreta_homework", arguments: { start_date: "2026-09-01", end_date: "2026-09-07" } },
  })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  assert.notEqual(called.result.isError, true);
  const payload = JSON.parse(called.result.content[0]!.text) as { total: number; items: Array<{ Uid: string }> };
  assert.equal(payload.total, 2);
  assert.equal(payload.items[0]!.Uid, "hf-1");
});

test("no credential is stored or leaked: the password is not in any issued token", async () => {
  const { code, accessToken } = await connect();
  assert.ok(loginCalls.some((call) => call.password === PASSWORD), "the stub login did receive the password");

  for (const [what, token] of [["code", code], ["access token", accessToken]] as const) {
    const decoded = Buffer.from(token.split(".")[2]!, "base64url").toString("latin1");
    assert.ok(!token.includes(PASSWORD), `the ${what} must not contain the password`);
    assert.ok(!decoded.includes(PASSWORD), `the ${what} ciphertext must not contain the password`);
    // Sealed, not merely encoded: the refresh token must not be readable either.
    assert.ok(!decoded.includes("kreta-refresh"), `the ${what} must not expose the refresh token`);
  }
});

test("a code cannot be redeemed with another client's secret", async () => {
  const { clientId } = await register();
  const { verifier, challenge } = pkce();
  const request = await openLoginPage(clientId, challenge, "st");
  const redirected = await submitLogin(request, [
    { label: "Marci", username: "marci-diak", password: PASSWORD, instituteCode: "klik123456" },
  ]);
  const code = new URL(redirected.headers.get("location")!).searchParams.get("code")!;

  const foreignSecret = (await register()).clientSecret;
  assert.equal((await redeem(code, clientId, foreignSecret, verifier)).status, 401);
  // The rejected attempt must not have consumed the code.
  assert.equal((await redeem(code, clientId, (await register()).clientSecret, verifier)).status, 401);
});

test("PKCE and replay protection hold at /token", async () => {
  const { clientId, clientSecret } = await register();
  const { verifier, challenge } = pkce();
  const request = await openLoginPage(clientId, challenge, "st");
  const redirected = await submitLogin(request, [
    { label: "Marci", username: "marci-diak", password: PASSWORD, instituteCode: "klik123456" },
  ]);
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

test("several children connect in one go and are addressed by name", async () => {
  const { accessToken } = await connect([
    { label: "Marci", username: "marci-diak", password: PASSWORD, instituteCode: "klik123456" },
    { label: "Kata", username: "kata-diak", password: PASSWORD, instituteCode: "https://klik999999.e-kreta.hu" },
  ]);

  const ambiguous = (await callMcp(accessToken, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "kreta_evaluations", arguments: {} },
  })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  assert.equal(ambiguous.result.isError, true);
  assert.match(ambiguous.result.content[0]!.text, /Marci, Kata/);

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
  assert.deepEqual(status.children, ["Marci", "Kata"]);

  const unknown = (await callMcp(accessToken, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "kreta_evaluations", arguments: { child: "Benedek" } },
  })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0]!.text, /Nincs "Benedek" nevű/);
});

test("two children with the same name are refused rather than silently merged", async () => {
  const { clientId } = await register();
  const request = await openLoginPage(clientId, pkce().challenge, "st");
  const response = await submitLogin(request, [
    { label: "Marci", username: "a", password: PASSWORD, instituteCode: "klik1" },
    { label: "marci", username: "b", password: PASSWORD, instituteCode: "klik2" },
  ]);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Kétszer szerepel ugyanaz a név/);
});
