import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  assertFreshRelayRequest,
  createKretaRelayFetch,
  isAllowedKretaUrl,
  KretaRelayError,
  openRelayPayload,
  sealRelayPayload,
  type RelayRequest,
  type RelayResponse,
} from "../src/kreta/relay.js";

const KEY = randomBytes(32).toString("base64url");

test("relay envelopes are authenticated and reject a different key", () => {
  const sealed = sealRelayPayload({ password: "never logged" }, KEY);
  assert.deepEqual(openRelayPayload(sealed, KEY), { password: "never logged" });
  assert.throws(
    () => openRelayPayload(sealed, randomBytes(32).toString("base64url")),
    KretaRelayError,
  );
});

test("the relay only accepts HTTPS hosts controlled by eKRÉTA", () => {
  for (const url of [
    "https://idp.e-kreta.hu/connect/authorize",
    "https://klik034802001.e-kreta.hu/ellenorzo/v3/sajat/TanuloAdatlap",
    "https://intezmenykereso.e-kreta.hu/instituteSelector/budenz",
    "https://kretaglobalmobileapi2.ekreta.hu/api/v3/Institute",
  ]) {
    assert.equal(isAllowedKretaUrl(url), true);
  }
  for (const url of [
    "http://idp.e-kreta.hu/connect/token",
    "https://idp.e-kreta.hu:8443/connect/token",
    "https://e-kreta.hu.example.com/steal",
    "https://example.com/",
  ]) {
    assert.equal(isAllowedKretaUrl(url), false);
  }
});

test("eKRÉTA fetches use the encrypted relay while unrelated fetches stay direct", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    if (url === "https://relay.example/v1/fetch") {
      const request = openRelayPayload<RelayRequest>(String(init?.body), KEY);
      assert.equal(request.request.url, "https://idp.e-kreta.hu/connect/token");
      assert.equal(request.request.method, "POST");
      assert.equal(request.request.body, "grant_type=refresh_token");
      assert.deepEqual(request.request.headers, [["content-type", "application/x-www-form-urlencoded"]]);
      assertFreshRelayRequest(request, request.issuedAt);
      const result: RelayResponse = {
        id: request.id,
        response: {
          status: 200,
          statusText: "OK",
          headers: [["content-type", "application/json"]],
          bodyBase64: Buffer.from('{"access_token":"token"}').toString("base64"),
        },
      };
      return new Response(sealRelayPayload(result, KEY), { status: 200 });
    }
    return new Response("direct", { status: 200 });
  };
  const relayFetch = createKretaRelayFetch({
    relayUrl: "https://relay.example/v1/fetch",
    relayKey: KEY,
    fetchImpl: fakeFetch as typeof fetch,
    now: () => 1_788_458_400_000,
  });

  const relayed = await relayFetch("https://idp.e-kreta.hu/connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token",
  });
  assert.equal(await relayed.text(), '{"access_token":"token"}');
  const direct = await relayFetch("https://accounts.google.com/", {});
  assert.equal(await direct.text(), "direct");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://relay.example/v1/fetch");
  assert.equal(calls[1]?.url, "https://accounts.google.com/");
});

test("stale relay requests are rejected before reaching an upstream host", () => {
  const request: RelayRequest = {
    id: "old-request",
    issuedAt: 1_000,
    request: {
      url: "https://idp.e-kreta.hu/connect/token",
      method: "POST",
      headers: [],
      body: null,
    },
  };
  assert.throws(() => assertFreshRelayRequest(request, 62_000), KretaRelayError);
});

test("bodyless upstream responses stay valid Fetch responses", async () => {
  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    assert.equal(input.toString(), "https://relay.example/v1/fetch");
    const request = openRelayPayload<RelayRequest>(String(init?.body), KEY);
    return new Response(
      sealRelayPayload(
        {
          id: request.id,
          response: {
            status: 204,
            statusText: "No Content",
            headers: [],
            bodyBase64: "",
          },
        } satisfies RelayResponse,
        KEY,
      ),
      { status: 200 },
    );
  };
  const relayFetch = createKretaRelayFetch({
    relayUrl: "https://relay.example/v1/fetch",
    relayKey: KEY,
    fetchImpl: fakeFetch as typeof fetch,
  });

  const response = await relayFetch("https://idp.e-kreta.hu/connect/endsession");
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});
