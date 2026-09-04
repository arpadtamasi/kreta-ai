import { refresh, type KretaTokens } from "../kreta/auth.js";
import type { Sealer } from "../seal.js";
import { claimConnection, openConnectionCredential, renewConnection, retryConnection } from "./connection.js";
import type { ChildProfileStore } from "./store.js";

export interface RefreshConnectionsResult {
  due: number;
  refreshed: number;
  conflicted: number;
  failed: number;
  expired: number;
  ended: number;
}

export async function refreshDueConnections(options: {
  store: ChildProfileStore;
  sealer: Sealer;
  fetchImpl?: typeof fetch;
  refreshImpl?: (refreshToken: string, fetchImpl?: typeof fetch) => Promise<KretaTokens>;
  now?: number;
  limit?: number;
}): Promise<RefreshConnectionsResult> {
  const now = options.now ?? Date.now();
  const due = await options.store.listDueConnections(new Date(now), options.limit ?? 40);
  const result: RefreshConnectionsResult = {
    due: due.length,
    refreshed: 0,
    conflicted: 0,
    failed: 0,
    expired: 0,
    ended: 0,
  };
  const doRefresh = options.refreshImpl ?? refresh;

  for (const { uid, profile } of due) {
    const connection = profile.connection;
    if (!connection) continue;
    if (connection.mode === "trial") {
      if (await options.store.clearConnection(uid, profile.id, connection.version)) result.expired += 1;
      else result.conflicted += 1;
      continue;
    }
    if (connection.keepAliveUntil && now >= Date.parse(connection.keepAliveUntil)) {
      if (await options.store.clearConnection(uid, profile.id, connection.version)) result.ended += 1;
      else result.conflicted += 1;
      continue;
    }
    let credential;
    try {
      credential = openConnectionCredential(options.sealer, connection, now);
    } catch {
      if (await options.store.clearConnection(uid, profile.id, connection.version)) result.expired += 1;
      else result.conflicted += 1;
      continue;
    }

    const claimed = claimConnection(connection, now);
    if (!await options.store.updateConnection(uid, profile.id, connection.version, claimed)) {
      result.conflicted += 1;
      continue;
    }

    try {
      const tokens = await doRefresh(credential.refreshToken, options.fetchImpl);
      const next = renewConnection(options.sealer, claimed, tokens, now);
      if (await options.store.updateConnection(uid, profile.id, claimed.version, next)) {
        result.refreshed += 1;
      } else {
        result.conflicted += 1;
      }
    } catch {
      const retry = retryConnection(claimed, now);
      if (await options.store.updateConnection(uid, profile.id, claimed.version, retry)) {
        result.failed += 1;
      } else {
        result.conflicted += 1;
      }
    }
  }
  return result;
}
