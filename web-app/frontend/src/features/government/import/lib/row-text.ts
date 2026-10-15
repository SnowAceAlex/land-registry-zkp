import type { Dictionary } from '@/i18n/dictionaries';

import type { ImportRowCode } from '../../api/types';

export type { ImportRowCode };

export type RowTextStrings = Pick<Dictionary['govImport'], 'rowCodes'>;

/** Dictionary text for a coded row; rows without a (known) code keep the backend message. */
export function rowText(
  row: { code?: ImportRowCode; message: string },
  t: RowTextStrings,
): string {
  const codes: Partial<Record<string, string>> = t.rowCodes;
  return (row.code && codes[row.code]) || row.message;
}
