/**
 * common/ttl-cache.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One value, three ages, and never two loads at once (D74).
 *
 * WHY IT IS NEEDED. After D72 a proof request is TREE_DEPTH key lookups — but
 * it still asks the chain for the current root. Measured against Sepolia that
 * read costs **p50 2,883 ms** (731–4,560), versus 6 ms when this cache answers.
 * Without it the bottleneck would simply have moved from the tree to the RPC.
 *
 * THREE AGES, because a TTL alone does not fix the tail. With a plain 2-second
 * expiry, one request every two seconds paid the full ~3 s RPC cost and blocked
 * the requests behind it — measured p99 of 1,003 ms and a worst case of 17,476 ms
 * on `GET /api/proof/:id`. Raising the TTL only makes that rarer, never absent:
 * whoever lands on the expiry still waits.
 *
 *   age < ttlMs                fresh  → serve, no load
 *   ttlMs ≤ age < staleMs      stale  → serve IMMEDIATELY, refresh in background
 *   age ≥ staleMs              dead   → block and load (the only waiting path)
 *
 * On a server with steady traffic the middle band means the value is refreshed
 * continuously in the background and **no request ever waits for the RPC**. The
 * dead band still exists so a cache left idle for minutes cannot hand out
 * something arbitrarily old.
 *
 * `inflight` is not a micro-optimisation. Without it, 100 requests that miss in
 * the same tick each start their own load, and the TTL does nothing about the
 * exact burst it was added to absorb. It also makes the background refresh safe:
 * a stale-serving request and a dead-band request share one load.
 *
 * A failed load is NOT cached: an RPC that is down for a second must not become
 * an error that lasts a whole TTL. A failed BACKGROUND refresh is swallowed and
 * the stale value keeps being served — until `staleMs`, after which the next
 * caller blocks and gets the real error.
 */
export interface TtlCacheOptions {
  /**
   * How long past `ttlMs` a value may still be served while it is refreshed in
   * the background. Defaults to `ttlMs`, i.e. no stale band — the original
   * block-on-expiry behaviour.
   */
  staleMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export class TtlCache<T> {
  private entry?: { value: T; storedAt: number };
  private inflight?: Promise<T>;
  private readonly staleMs: number;
  private readonly now: () => number;

  constructor(
    private readonly ttlMs: number,
    options: TtlCacheOptions = {},
  ) {
    this.staleMs = options.staleMs ?? ttlMs;
    this.now = options.now ?? Date.now;
  }

  async get(load: () => Promise<T>): Promise<T> {
    const entry = this.entry;
    const age = entry === undefined ? Number.POSITIVE_INFINITY : this.now() - entry.storedAt;

    if (entry !== undefined && age < this.ttlMs) return entry.value;

    if (entry !== undefined && age < this.staleMs) {
      // Serve the stale value and refresh behind the caller's back. The catch is
      // required, not defensive: an unawaited rejection would crash the process,
      // and a failed refresh here is a non-event — the stale value stands until
      // `staleMs`, and only then does a caller see the error.
      void this.refresh(load).catch(() => undefined);
      return entry.value;
    }

    return this.refresh(load);
  }

  /** Force the next read to go to the source. */
  invalidate(): void {
    this.entry = undefined;
  }

  private refresh(load: () => Promise<T>): Promise<T> {
    if (this.inflight) return this.inflight;

    this.inflight = load()
      .then((value) => {
        this.entry = { value, storedAt: this.now() };
        return value;
      })
      .finally(() => {
        this.inflight = undefined;
      });

    return this.inflight;
  }
}
