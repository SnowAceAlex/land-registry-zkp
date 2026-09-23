/**
 * common/ttl-cache.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One value, one expiry, and no duplicated loads while a load is in flight (D74).
 *
 * WHY IT IS NEEDED. After D72 a proof request is TREE_DEPTH key lookups — but
 * it still asks the chain twice for the current root. At 100 req/s that is 200
 * RPC calls a second against the node: the bottleneck would simply have moved
 * rather than gone away.
 *
 * `inflight` is not a micro-optimisation. Without it, 100 requests that miss in
 * the same tick each start their own load, and the TTL does nothing about the
 * exact burst it was added to absorb.
 *
 * A failed load is NOT cached: an RPC that is down for a second must not become
 * an error that lasts a whole TTL.
 */
export class TtlCache<T> {
  private entry?: { value: T; expiresAt: number };
  private inflight?: Promise<T>;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(load: () => Promise<T>): Promise<T> {
    const entry = this.entry;
    if (entry && entry.expiresAt > this.now()) return entry.value;
    if (this.inflight) return this.inflight;

    this.inflight = load()
      .then((value) => {
        this.entry = { value, expiresAt: this.now() + this.ttlMs };
        return value;
      })
      .finally(() => {
        this.inflight = undefined;
      });

    return this.inflight;
  }

  invalidate(): void {
    this.entry = undefined;
  }
}
