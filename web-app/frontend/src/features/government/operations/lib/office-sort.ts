import type { OfficeRow } from '../../api/types';

export type OfficeSortKey =
  | 'officeCode'
  | 'issuance'
  | 'transfer'
  | 'revocation'
  | 'held'
  | 'fallback'
  | 'oldestAgeHours';

export type SortDir = 'asc' | 'desc';

function compare(a: OfficeRow, b: OfficeRow, key: OfficeSortKey): number {
  if (key === 'officeCode') {
    return (a.officeCode ?? '').localeCompare(b.officeCode ?? '', 'en', { numeric: true });
  }
  return (a[key] ?? 0) - (b[key] ?? 0);
}

/** The unassigned row (null code) stays last whichever way the table is sorted. */
export function sortOfficeRows(rows: OfficeRow[], key: OfficeSortKey, dir: SortDir): OfficeRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.officeCode === null || b.officeCode === null) {
      return Number(a.officeCode === null) - Number(b.officeCode === null);
    }
    return sign * compare(a, b, key);
  });
}
