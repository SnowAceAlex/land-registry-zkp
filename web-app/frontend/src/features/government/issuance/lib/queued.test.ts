import { describe, expect, it } from 'vitest';

import { groupByOffice, queuedPropertyIds, requestablePicks } from './queued';

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

describe('groupByOffice', () => {
  const ready = (propertyId: string, landOfficeCode: string | null) => ({
    propertyId,
    landOfficeCode,
  });

  it('orders branches by code, unassigned last, and plots numerically inside each', () => {
    const groups = groupByOffice([
      ready('10', 'CN02'),
      ready('7', null),
      ready('2', 'CN02'),
      ready('30', 'CN01'),
      ready('9', 'CN02'),
    ]);
    expect(groups.map((g) => [g.officeCode, g.requests.map((r) => r.propertyId)])).toEqual([
      ['CN01', ['30']],
      ['CN02', ['2', '9', '10']],
      [null, ['7']],
    ]);
  });

  it('is empty for no requests', () => {
    expect(groupByOffice([])).toEqual([]);
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
