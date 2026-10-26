import { describe, expect, it } from 'vitest';

import type { OfficeRow } from '../../api/types';
import { sortOfficeRows } from './office-sort';

const row = (officeCode: string | null, over: Partial<OfficeRow> = {}): OfficeRow => ({
  officeCode,
  officeName: officeCode,
  kind: officeCode ? 'BRANCH' : null,
  issuance: 0,
  transfer: 0,
  revocation: 0,
  held: 0,
  fallback: 0,
  oldestAgeHours: null,
  ...over,
});

const codes = (rows: OfficeRow[]) => rows.map((r) => r.officeCode);

describe('sortOfficeRows', () => {
  const rows = [row('CN10'), row(null), row('CN02'), row('CN03')];

  it('keeps the unassigned row last in both directions', () => {
    expect(codes(sortOfficeRows(rows, 'officeCode', 'asc'))).toEqual(['CN02', 'CN03', 'CN10', null]);
    expect(codes(sortOfficeRows(rows, 'officeCode', 'desc'))).toEqual(['CN10', 'CN03', 'CN02', null]);
  });

  it('compares numeric keys as numbers, not text', () => {
    const data = [
      row('A', { transfer: 9 }),
      row('B', { transfer: 100 }),
      row(null, { transfer: 1000 }),
      row('C', { transfer: 20 }),
    ];
    expect(codes(sortOfficeRows(data, 'transfer', 'asc'))).toEqual(['A', 'C', 'B', null]);
    expect(codes(sortOfficeRows(data, 'transfer', 'desc'))).toEqual(['B', 'C', 'A', null]);
  });

  it('sorts a missing age as zero', () => {
    const data = [row('A', { oldestAgeHours: 5 }), row('B', { oldestAgeHours: null }), row('C', { oldestAgeHours: 1 })];
    expect(codes(sortOfficeRows(data, 'oldestAgeHours', 'asc'))).toEqual(['B', 'C', 'A']);
  });

  it('is stable for ties, in both directions', () => {
    const data = [row('X', { held: 1 }), row('Y', { held: 1 }), row('Z', { held: 0 })];
    expect(codes(sortOfficeRows(data, 'held', 'asc'))).toEqual(['Z', 'X', 'Y']);
    expect(codes(sortOfficeRows(data, 'held', 'desc'))).toEqual(['X', 'Y', 'Z']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    sortOfficeRows(rows, 'officeCode', 'desc');
    expect(rows).toEqual(copy);
  });
});
