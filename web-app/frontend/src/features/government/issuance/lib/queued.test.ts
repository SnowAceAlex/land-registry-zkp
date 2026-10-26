import { describe, expect, it } from 'vitest';

import { queuedPropertyIds, requestablePicks } from './queued';

const request = (propertyId: string, status: 'READY' | 'PUBLISHED' | 'WITHDRAWN') => ({
  propertyId,
  status,
});

describe('queuedPropertyIds', () => {
  it('collects the plots that still have a READY request', () => {
    const ids = queuedPropertyIds([request('1', 'READY'), request('2', 'READY')]);
    expect([...ids].sort()).toEqual(['1', '2']);
  });

  it('ignores requests that are no longer open', () => {
    const ids = queuedPropertyIds([request('1', 'PUBLISHED'), request('2', 'WITHDRAWN')]);
    expect(ids.size).toBe(0);
  });

  it('is empty before the list has loaded', () => {
    expect(queuedPropertyIds(undefined).size).toBe(0);
  });
});

describe('requestablePicks', () => {
  it('drops picked plots that were queued meanwhile', () => {
    const picked = new Set(['1', '2', '3']);
    expect(requestablePicks(picked, new Set(['2']))).toEqual(['1', '3']);
  });

  it('keeps every pick when nothing is queued', () => {
    expect(requestablePicks(new Set(['5']), new Set())).toEqual(['5']);
  });
});
