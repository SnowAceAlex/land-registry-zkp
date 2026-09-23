import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('loads once inside the TTL', async () => {
    let now = 1_000;
    const load = jest.fn(async () => 'v1');
    const cache = new TtlCache<string>(2_000, () => now);

    expect(await cache.get(load)).toBe('v1');
    now = 2_500;
    expect(await cache.get(load)).toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has passed', async () => {
    let now = 1_000;
    let value = 'v1';
    const cache = new TtlCache<string>(2_000, () => now);

    expect(await cache.get(async () => value)).toBe('v1');
    now = 3_001;
    value = 'v2';
    expect(await cache.get(async () => value)).toBe('v2');
  });

  it('invalidate() forces the next read to reload', async () => {
    let value = 'v1';
    const cache = new TtlCache<string>(60_000, () => 0);

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
    const cache = new TtlCache<number>(1_000, () => 0);
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
    const cache = new TtlCache<string>(60_000, () => 0);

    await expect(cache.get(async () => Promise.reject(new Error('rpc down')))).rejects.toThrow(
      'rpc down',
    );
    expect(await cache.get(async () => 'ok')).toBe('ok');
  });

  it('lets a failure reach every caller that was waiting on it', async () => {
    // The in-flight promise is shared, so a rejection has to reach all of its
    // waiters — swallowing it for the later ones would hand them `undefined`.
    const cache = new TtlCache<string>(1_000, () => 0);
    const load = async (): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('rpc down');
    };

    const results = await Promise.allSettled([cache.get(load), cache.get(load)]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });
});
