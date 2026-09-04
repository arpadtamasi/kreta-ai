/**
 * Sealed values — authenticated encryption for short-lived OAuth artifacts
 * and explicitly opted-in, server-side KRÉTA connection credentials.
 *
 * OAuth codes and access tokens carry their encrypted context themselves.
 * A child connection's access and refresh tokens use the same AES-256-GCM
 * envelope but stay in the Google-owned profile store; client-facing OAuth
 * artifacts contain only profile references.
 *
 * Be precise about what at-rest encryption does and does not buy: the
 * service holds the key, so this is not zero knowledge. Credential envelopes
 * carry a hard expiry and are removed when the connection is switched off.
 *
 * The `purpose` is bound as AES-GCM additional authenticated data, so a
 * sealed authorization code can never be replayed as an access token, or
 * vice versa: decryption under the wrong purpose fails the tag check.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type SealPurpose =
  | "code"
  | "access"
  | "client"
  | "request"
  | "credential"
  | "classroom_state"
  | "classroom_credential";

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

/** Payload fields every sealed value carries, checked on open. */
interface Envelope<T> {
  p: SealPurpose;
  /** Absolute expiry, epoch milliseconds. */
  exp: number;
  v: T;
}

export class Sealer {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new SealError(`Sealing key must be ${KEY_BYTES} bytes, got ${key.length}.`);
    }
    this.key = key;
  }

  /**
   * Parses the base64 key from configuration. Kept separate from the
   * constructor so a misconfigured deployment fails at startup with a
   * readable message rather than on the first request.
   */
  static fromBase64(value: string): Sealer {
    let decoded: Buffer;
    try {
      decoded = Buffer.from(value, "base64");
    } catch {
      throw new SealError("TOKEN_SEALING_KEY is not valid base64.");
    }
    if (decoded.length !== KEY_BYTES) {
      throw new SealError(
        `TOKEN_SEALING_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}). ` +
          `Generate one with: npm run keygen`,
      );
    }
    return new Sealer(decoded);
  }

  seal<T>(purpose: SealPurpose, value: T, ttlSeconds: number, now: number = Date.now()): string {
    const envelope: Envelope<T> = { p: purpose, exp: now + ttlSeconds * 1000, v: value };
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const body = Buffer.concat([cipher.update(JSON.stringify(envelope), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64url"), Buffer.concat([body, tag]).toString("base64url")].join(".");
  }

  /**
   * Opens a sealed value, or throws. A wrong purpose, a tampered token, a
   * token sealed under a different key, and an expired token are all the
   * same answer to the caller — there is nothing useful to tell apart.
   */
  open<T>(purpose: SealPurpose, token: string, now: number = Date.now()): T {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION) {
      throw new SealError("Malformed sealed token.");
    }
    const iv = Buffer.from(parts[1]!, "base64url");
    const payload = Buffer.from(parts[2]!, "base64url");
    if (iv.length !== IV_BYTES || payload.length <= 16) {
      throw new SealError("Malformed sealed token.");
    }
    const tag = payload.subarray(payload.length - 16);
    const body = payload.subarray(0, payload.length - 16);

    let plaintext: string;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(purpose, "utf8"));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      throw new SealError("Sealed token failed authentication.");
    }

    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(plaintext) as Envelope<T>;
    } catch {
      throw new SealError("Sealed token payload is not JSON.");
    }
    if (envelope.p !== purpose) {
      throw new SealError("Sealed token purpose mismatch.");
    }
    if (typeof envelope.exp !== "number" || now >= envelope.exp) {
      throw new SealError("Sealed token has expired.");
    }
    return envelope.v;
  }

  /**
   * Derives a client secret from a client id. Dynamic Client Registration
   * (RFC 7591) normally means a client table; here the secret *is* a MAC
   * over the id, so /token can verify a client we issued without ever
   * having written it down.
   */
  deriveClientSecret(clientId: string): string {
    return createHmac("sha256", this.key).update(`client:${clientId}`).digest("base64url");
  }

  verifyClientSecret(clientId: string, presented: string): boolean {
    const expected = Buffer.from(this.deriveClientSecret(clientId), "utf8");
    const actual = Buffer.from(presented, "utf8");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}

/** High-entropy opaque identifier (base64url, no padding). */
export function randomId(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
