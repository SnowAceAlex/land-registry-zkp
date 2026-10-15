import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

import type { Alert } from '../../api/types';

const TONES = { error: 'danger', warning: 'warning', info: 'info' } as const;

/** Words a coded alert (D89); an alert with no office speaks of the unassigned plots. */
export function alertText(
  alert: Alert,
  t: Dictionary['govOperations'],
): { tone: 'danger' | 'warning' | 'info'; title: string } {
  const template = t.alerts[alert.code];
  const values: Record<string, string | number> = { office: alert.officeCode ?? t.alertNoOffice };
  if (alert.count !== undefined) values.count = alert.count;
  if (alert.ref !== undefined) values.ref = alert.ref;

  return { tone: TONES[alert.severity], title: format(template, values) };
}
