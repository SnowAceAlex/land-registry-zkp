// F9: pick the open-procedure message by kind — the old single "#{id}" string didn't say which.
import { format } from '@/i18n/format';
import type { Dictionary } from '@/i18n/dictionaries';
import type { FreezeStatus } from '../api/types';

export function openProcedureMessage(
  t: Dictionary['govFreeze'],
  openProcedure: NonNullable<FreezeStatus['openProcedure']>,
): string {
  return format(
    openProcedure.kind === 'transfer' ? t.openProcedureTransfer : t.openProcedureRevocation,
    { id: openProcedure.id },
  );
}
