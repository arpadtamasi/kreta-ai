import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { Sealer, SealError } from "../src/seal.js";

const key = randomBytes(32);
const sealer = new Sealer(key);

test("seals and opens a payload unchanged", () => {
  const value = { sid: "abc", children: [{ label: "Marci", refreshToken: "rt-1" }] };
  assert.deepEqual(sealer.open("access", sealer.seal("access", value, 60)), value);
});

test("a token sealed for one purpose cannot be opened as another", () => {
  const token = sealer.seal("code", { jti: "x" }, 60);
  assert.throws(() => sealer.open("access", token), SealError);
});

test("an expired token is refused", () => {
  const token = sealer.seal("access", { sid: "abc" }, 1);
  assert.throws(() => sealer.open("access", token, Date.now() + 2000), SealError);
});

test("a token sealed under another key is refused", () => {
  const other = new Sealer(randomBytes(32));
  assert.throws(() => sealer.open("access", other.seal("access", { sid: "abc" }, 60)), SealError);
});

test("tampering with the ciphertext is detected", () => {
  const token = sealer.seal("access", { sid: "abc" }, 60);
  const parts = token.split(".");
  const body = Buffer.from(parts[2]!, "base64url");
  body[0] = body[0]! ^ 0xff;
  const tampered = [parts[0], parts[1], body.toString("base64url")].join(".");
  assert.throws(() => sealer.open("access", tampered), SealError);
});

test("malformed tokens are refused rather than crashing", () => {
  for (const bad of ["", "nonsense", "v1.a", "v2.aaaa.bbbb", "v1..", "v1.!!!.???"]) {
    assert.throws(() => sealer.open("access", bad), SealError);
  }
});

test("client secrets verify only against their own client id", () => {
  const clientId = sealer.seal("client", { r: ["https://claude.ai/api/mcp/auth_callback"] }, 60);
  const secret = sealer.deriveClientSecret(clientId);
  assert.ok(sealer.verifyClientSecret(clientId, secret));
  assert.equal(sealer.verifyClientSecret(clientId, `${secret}x`), false);
  assert.equal(sealer.verifyClientSecret("other-id", secret), false);
});

test("the key must be exactly 32 bytes", () => {
  assert.throws(() => Sealer.fromBase64(randomBytes(16).toString("base64")), SealError);
  assert.doesNotThrow(() => Sealer.fromBase64(randomBytes(32).toString("base64")));
});
