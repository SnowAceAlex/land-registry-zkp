import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

import type { ImportRowCode } from '../../api/types';

export type { ImportRowCode };

export type RowTextStrings = Pick<Dictionary['govImport'], 'rowCodes'>;

/** Dictionary text for a coded row, naming its predecessor; no (known) code keeps the backend message. */
export function rowText(
  row: { code?: ImportRowCode; message: string; predecessorPropertyId?: string },
  t: RowTextStrings,
): string {
  const codes: Record<string, string> = t.rowCodes;
  if (!row.code || !Object.hasOwn(codes, row.code)) return row.message;
  return format(codes[row.code], { predecessor: row.predecessorPropertyId ?? '?' });
}
