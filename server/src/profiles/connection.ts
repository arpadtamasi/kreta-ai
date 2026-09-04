import type { KretaTokens } from "../kreta/auth.js";
import type { Sealer } from "../seal.js";
import type { ChildConnection, ConnectionMode } from "./store.js";

export const TRIAL_CONNECTION_MS = 30 * 60 * 1000;
export const KEEP_ALIVE_REFRESH_MS = 25 * 60 * 1000;
// A frissítéseket szórjuk, mert az ötpercenkénti job különben minden együtt
// létrehozott kapcsolatot ugyanabban a percben tolna rá a KRÉTA-ra. A szórás
// csak korábbra húz: a 30 perces access token miatt későbbre nem tolhatunk.
export const KEEP_ALIVE_JITTER_MS = 4 * 60 * 1000;
// Every stored credential expires by itself if the refresher stops. The
// 60-minute window tolerates one missed 25-minute run without turning the
// opt-in storage into an indefinitely readable database secret.
export const KEEP_ALIVE_CREDENTIAL_MS = 60 * 60 * 1000;
export const REFRESH_RETRY_MS = 5 * 60 * 1000;

/** 21–25 perc: mindig a 25 perces határ alatt, de nem mindig ugyanakkor. */
export function nextRefreshDelayMs(random: () => number = Math.random): number {
  return KEEP_ALIVE_REFRESH_MS - Math.floor(random() * KEEP_ALIVE_JITTER_MS);
}

export interface StoredKretaCredential {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
}

export function connectionIsOnline(connection: ChildConnection, now: number = Date.now()): boolean {
  return now < Date.parse(connection.expiresAt) &&
    (!connection.keepAliveUntil || now < Date.parse(connection.keepAliveUntil));
}

function credentialFrom(tokens: KretaTokens, now: number): StoredKretaCredential {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: now + tokens.expiresIn * 1000,
  };
}

function sealCredential(
  sealer: Sealer,
  credential: StoredKretaCredential,
  expiresAt: number,
  now: number,
): string {
  const ttlSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));
  return sealer.seal("credential", credential, ttlSeconds, now);
}

export function createConnection(
  sealer: Sealer,
  tokens: KretaTokens,
  mode: ConnectionMode,
  keepAliveUntil?: string,
  now: number = Date.now(),
  random: () => number = Math.random,
): ChildConnection {
  const expiresAt = mode === "keep_alive"
    ? now + KEEP_ALIVE_CREDENTIAL_MS
    : now + Math.min(TRIAL_CONNECTION_MS, tokens.expiresIn * 1000);
  const timestamp = new Date(now).toISOString();
  return {
    credential: sealCredential(sealer, credentialFrom(tokens, now), expiresAt, now),
    mode,
    state: "active",
    connectedAt: timestamp,
    refreshedAt: timestamp,
    expiresAt: new Date(expiresAt).toISOString(),
    ...(mode === "keep_alive"
      ? { nextRefreshAt: new Date(now + nextRefreshDelayMs(random)).toISOString() }
      : {}),
    ...(mode === "keep_alive" && keepAliveUntil ? { keepAliveUntil } : {}),
    version: 1,
    consecutiveFailures: 0,
  };
}

export function renewConnection(
  sealer: Sealer,
  previous: ChildConnection,
  tokens: KretaTokens,
  now: number = Date.now(),
  random: () => number = Math.random,
): ChildConnection {
  const expiresAt = previous.mode === "keep_alive"
    ? now + KEEP_ALIVE_CREDENTIAL_MS
    : Date.parse(previous.expiresAt);
  return {
    credential: sealCredential(sealer, credentialFrom(tokens, now), expiresAt, now),
    mode: previous.mode,
    state: "active",
    connectedAt: previous.connectedAt,
    refreshedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    ...(previous.mode === "keep_alive"
      ? { nextRefreshAt: new Date(now + nextRefreshDelayMs(random)).toISOString() }
      : {}),
    ...(previous.keepAliveUntil ? { keepAliveUntil: previous.keepAliveUntil } : {}),
    version: previous.version + 1,
    consecutiveFailures: 0,
  };
}

export function retryConnection(
  previous: ChildConnection,
  now: number = Date.now(),
): ChildConnection {
  const retryAt = Math.min(
    now + REFRESH_RETRY_MS,
    Date.parse(previous.expiresAt),
    previous.keepAliveUntil ? Date.parse(previous.keepAliveUntil) : Number.POSITIVE_INFINITY,
  );
  return {
    ...previous,
    state: "attention",
    nextRefreshAt: new Date(retryAt).toISOString(),
    version: previous.version + 1,
    consecutiveFailures: previous.consecutiveFailures + 1,
    lastErrorAt: new Date(now).toISOString(),
  };
}

/**
 * Reserves one rotating refresh token before making the non-transactional
 * KRÉTA request. The version bump prevents two workers from presenting the
 * same single-use refresh token concurrently.
 */
export function claimConnection(
  previous: ChildConnection,
  now: number = Date.now(),
): ChildConnection {
  const retryAt = Math.min(
    now + REFRESH_RETRY_MS,
    Date.parse(previous.expiresAt),
    previous.keepAliveUntil ? Date.parse(previous.keepAliveUntil) : Number.POSITIVE_INFINITY,
  );
  return {
    ...previous,
    nextRefreshAt: new Date(retryAt).toISOString(),
    version: previous.version + 1,
  };
}

export function openConnectionCredential(
  sealer: Sealer,
  connection: ChildConnection,
  now: number = Date.now(),
): StoredKretaCredential {
  if (now >= Date.parse(connection.expiresAt)) throw new Error("connection_expired");
  return sealer.open<StoredKretaCredential>("credential", connection.credential, now);
}
