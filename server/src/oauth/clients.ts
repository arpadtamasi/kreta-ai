/**
 * Stateless Dynamic Client Registration (RFC 7591).
 *
 * A registered client is normally a database row. Here the row *is* the
 * client_id: the id is a sealed blob carrying the client's name and its
 * registered redirect URIs, and the secret is a MAC over that id. /authorize
 * and /token can therefore verify a client we issued — and reject one we did
 * not — without this service having written anything down.
 *
 * The registered redirect URIs are still checked against the deployment's
 * allowlist at registration time, so a stranger who registers a client can
 * never point a parent's authorization code somewhere else.
 */
import type { Sealer } from "../seal.js";

/** Ten years: a client registration is not something a parent should have to redo. */
const CLIENT_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export interface ClientRecord {
  /** Human-readable name shown on the login page, if the client supplied one. */
  n?: string;
  /** Redirect URIs the client registered. */
  r: string[];
}

export function issueClientId(sealer: Sealer, record: ClientRecord): string {
  return sealer.seal("client", record, CLIENT_TTL_SECONDS);
}

export function openClientId(sealer: Sealer, clientId: string): ClientRecord | null {
  try {
    const record = sealer.open<ClientRecord>("client", clientId);
    if (!Array.isArray(record.r) || record.r.some((uri) => typeof uri !== "string")) return null;
    return record;
  } catch {
    return null;
  }
}
