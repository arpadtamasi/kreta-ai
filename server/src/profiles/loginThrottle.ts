/**
 * K5 — a profil-mentés KRÉTA-belépést végez, és a válasz megkülönbözteti a
 * sikeres és a sikertelen jelszót. Korlátozás nélkül ez credential-stuffing
 * proxy magyar iskolák IDP-je ellen, a mi IP-nkről.
 *
 * A számláló a példányban él, ami a `--max-instances=1` mellett elég (ugyanaz a
 * megfontolás, mint a replay-cache-nél); több példánynál közös tárra kell váltani.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

interface Bucket {
  failures: number;
  resetAt: number;
}

export class LoginThrottle {
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  #bucket(key: string): Bucket {
    const now = this.#now();
    const existing = this.#buckets.get(key);
    if (existing && existing.resetAt > now) return existing;
    const fresh: Bucket = { failures: 0, resetAt: now + WINDOW_MS };
    this.#buckets.set(key, fresh);
    return fresh;
  }

  /** Hátralévő másodperc, ha zárva van; 0, ha mehet a próbálkozás. */
  retryAfter(key: string): number {
    const bucket = this.#bucket(key);
    if (bucket.failures < MAX_FAILURES) return 0;
    return Math.max(1, Math.ceil((bucket.resetAt - this.#now()) / 1000));
  }

  recordFailure(key: string): void {
    this.#bucket(key).failures += 1;
  }

  /** Sikeres belépés tisztít: a valódi szülőt nem büntetjük egy elgépelésért. */
  clear(key: string): void {
    this.#buckets.delete(key);
  }

  /** Lejárt vödrök takarítása, hogy a Map ne nőjön korlátlanul. */
  prune(): void {
    const now = this.#now();
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
  }
}
