/**
 * Single-use enforcement for authorization codes.
 *
 * OAuth 2.1 requires a code to be redeemable exactly once. With no database
 * that guarantee is per-process: this remembers the jti of every code
 * redeemed by *this* instance until the code would have expired anyway.
 *
 * On a single-instance deployment that is the full guarantee. Beyond one
 * instance it degrades to "at most once per instance", which is why the
 * README tells you to deploy with `--max-instances=1`. Two independent
 * defences remain in every case: a code lives for two minutes, and PKCE
 * binds it to a verifier only the legitimate client holds.
 */
export class ReplayCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  /** Records the id and reports whether it was fresh (true) or a replay (false). */
  claim(id: string, now: number = Date.now()): boolean {
    this.sweep(now);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now + this.ttlMs);
    return true;
  }

  private sweep(now: number): void {
    for (const [id, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(id);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}
