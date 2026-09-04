import { createHash, timingSafeEqual } from "node:crypto";

/** Verifies an RFC 7636 S256 code_verifier against the stored challenge. */
export function verifyCodeVerifier(codeVerifier: string, codeChallenge: string): boolean {
  const computed = Buffer.from(createHash("sha256").update(codeVerifier, "ascii").digest("base64url"), "utf8");
  const expected = Buffer.from(codeChallenge, "utf8");
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}
