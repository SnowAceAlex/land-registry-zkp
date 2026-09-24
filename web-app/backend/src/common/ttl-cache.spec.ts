import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('loads once inside the TTL', async () => {
    let now = 1_000;
    const load = jest.fn(async () => 'v1');
    const cache = new TtlCache<string>(2_000, { now: () => now });

    expect(await cache.get(load)).toBe('v1');
    now = 2_500;
    expect(await cache.get(load)).toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has passed', async () => {
    let now = 1_000;
    let value = 'v1';
    const cache = new TtlCache<string>(2_000, { now: () => now });

    expect(await cache.get(async () => value)).toBe('v1');
    now = 3_001;
    value = 'v2';
    expect(await cache.get(async () => value)).toBe('v2');
  });

  it('invalidate() forces the next read to reload', async () => {
    let value = 'v1';
    const cache = new TtlCache<string>(60_000, { now: () => 0 });

    expect(await cache.get(async () => value)).toBe('v1');
    value = 'v2';
    cache.invalidate();
    expect(await cache.get(async () => value)).toBe('v2');
  });

  it('collapses concurrent misses into one load', async () => {
    // This is the reason the cache exists. At 100 req/s a cache that does not
    // collapse simultaneous misses still fires 100 loads in the same tick, and
    // the TTL does nothing about the exact burst it was added to stop.
    let calls = 0;
    const cache = new TtlCache<number>(1_000, { now: () => 0 });
    const load = async (): Promise<number> => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 42;
    };

    const results = await Promise.all([cache.get(load), cache.get(load), cache.get(load)]);

    expect(results).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('does not cache a failed load', async () => {
    // An RPC that is down for one second must not become an error that lasts a
    // whole TTL.
    const cache = new TtlCache<string>(60_000, { now: () => 0 });

    await expect(cache.get(async () => Promise.reject(new Error('rpc down')))).rejects.toThrow(
      'rpc down',
    );
    expect(await cache.get(async () => 'ok')).toBe('ok');
  });

  it('lets a failure reach every caller that was waiting on it', async () => {
    // The in-flight promise is shared, so a rejection has to reach all of its
    // waiters — swallowing it for the later ones would hand them `undefined`.
    const cache = new TtlCache<string>(1_000, { now: () => 0 });
    const load = async (): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('rpc down');
    };

    const results = await Promise.allSettled([cache.get(load), cache.get(load)]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });
});

describe('TtlCache under a failing loader (the Sepolia case)', () => {
  it('keeps serving the cached value while it is still fresh, even if the next load would fail', async () => {
    // The shape that matters on a real network: the RPC is intermittent, and a
    // request that arrives inside the TTL must not be dragged into the failure.
    let now = 1_000;
    const cache = new TtlCache<string>(2_000, { now: () => now });

    expect(await cache.get(async () => 'v1')).toBe('v1');
    now = 2_000;
    expect(await cache.get(async () => Promise.reject(new Error('rpc down')))).toBe('v1');
  });

  it('surfaces the failure once the value has expired, rather than serving it stale', async () => {
    // Deliberate: a stale root would make `inSync` and `rootVersion` lie. The
    // caller turns this into a 503 (ChainService.asServiceUnavailable), which
    // says "retry" — a stale-but-plausible answer would say nothing at all.
    let now = 1_000;
    const cache = new TtlCache<string>(2_000, { now: () => now });

    await cache.get(async () => 'v1');
    now = 5_000;

    await expect(cache.get(async () => Promise.reject(new Error('rpc down')))).rejects.toThrow(
      'rpc down',
    );
  });
});

describe('TtlCache stale-while-revalidate (D74, the Sepolia tail fix)', () => {
  /**
   * The measured problem: with a plain 2-second expiry against Sepolia, one
   * request every two seconds paid the full ~3 s RPC read and blocked whoever
   * was behind it — p99 1,003 ms, worst case 17,476 ms. Raising the TTL only
   * makes that rarer. The stale band removes it: past `ttlMs` the value is
   * served at once and refreshed behind the caller.
   */
  it('serves the stale value immediately and refreshes behind the caller', async () => {
    let now = 1_000;
    let served = 'v1';
    let loads = 0;
    const load = async (): Promise<string> => {
      loads++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return served;
    };
    const cache = new TtlCache<string>(10_000, { staleMs: 60_000, now: () => now });

    expect(await cache.get(load)).toBe('v1');
    expect(loads).toBe(1);

    // Past the TTL, inside the stale band: the caller must NOT wait for a load.
    now = 15_000;
    served = 'v2';
    expect(await cache.get(load)).toBe('v1');
    expect(loads).toBe(2); // a refresh was started...

    // ...and once it lands, the next read sees the new value with no wait.
    await new Promise((resolve) => setTimeout(resolve, 20));
    now = 16_000;
    expect(await cache.get(load)).toBe('v2');
  });

  it('blocks only once the value is past the stale band', async () => {
    let now = 1_000;
    const cache = new TtlCache<string>(10_000, { staleMs: 60_000, now: () => now });

    await cache.get(async () => 'v1');
    now = 100_000; // past staleMs — the one path that is allowed to wait

    await expect(cache.get(async () => Promise.reject(new Error('rpc down')))).rejects.toThrow(
      'rpc down',
    );
  });

  it('keeps serving stale when the background refresh fails', async () => {
    // An intermittent RPC must not turn into an error for the caller. The stale
    // value stands until staleMs; only then does anyone see the failure.
    let now = 1_000;
    const cache = new TtlCache<string>(10_000, { staleMs: 60_000, now: () => now });

    await cache.get(async () => 'v1');
    now = 20_000;

    expect(await cache.get(async () => Promise.reject(new Error('rpc down')))).toBe('v1');
    now = 21_000;
    expect(await cache.get(async () => Promise.reject(new Error('rpc down')))).toBe('v1');
  });

  it('defaults staleMs to ttlMs, keeping the original block-on-expiry behaviour', async () => {
    let now = 1_000;
    const cache = new TtlCache<string>(2_000, { now: () => now });

    expect(await cache.get(async () => 'v1')).toBe('v1');
    now = 4_000;
    // No stale band configured, so this caller does the load and sees v2.
    expect(await cache.get(async () => 'v2')).toBe('v2');
  });
});
