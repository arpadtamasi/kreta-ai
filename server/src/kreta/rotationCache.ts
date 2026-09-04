/**
 * In-memory latest-refresh-token cache.
 *
 * A sealed access token carries the refresh token captured at login. If the
 * KRÉTA IDP *rotates* refresh tokens (hands back a new one and invalidates
 * the presented one), that sealed copy goes stale the first time it is used
 * — and a storage-free server has nowhere to write the replacement.
 *
 * This cache is the graceful-degradation answer: keyed by the session id
 * sealed into the access token, it keeps the newest refresh token this
 * process has seen. On a single-instance deployment (Cloud Run
 * `--max-instances=1`) that covers the entire lifetime of a connection
 * except a cold start, after which we fall back to the sealed original —
 * which still works if the IDP does not rotate, and otherwise asks the
 * parent to reconnect. Nothing is persisted, so a restart loses the cache by
 * design, not by accident.
 *
 * If measurement shows KRÉTA does rotate and cold starts make reconnects
 * frequent, this is the seam where a durable store goes (README, "Ha
 * mégis rotál").
 */
export interface RotationCacheEntry {
  refreshToken: string;
  updatedAt: number;
}

export class RotationCache {
  private readonly entries = new Map<string, RotationCacheEntry>();

  constructor(
    private readonly maxEntries = 5_000,
    private readonly ttlMs = 30 * 24 * 60 * 60 * 1000,
  ) {}

  get(sessionId: string, now: number = Date.now()): string | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) return undefined;
    if (now - entry.updatedAt > this.ttlMs) {
      this.entries.delete(sessionId);
      return undefined;
    }
    // Refresh LRU position: re-inserting moves the key to the newest end.
    this.entries.delete(sessionId);
    this.entries.set(sessionId, entry);
    return entry.refreshToken;
  }

  set(sessionId: string, refreshToken: string, now: number = Date.now()): void {
    this.entries.delete(sessionId);
    this.entries.set(sessionId, { refreshToken, updatedAt: now });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  get size(): number {
    return this.entries.size;
  }
}
