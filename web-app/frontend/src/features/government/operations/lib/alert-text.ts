import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

import type { Alert } from '../../api/types';

const TONES = { error: 'danger', warning: 'warning', info: 'info' } as const;

/** Words a coded alert (D89). An office the sentence does not name itself is appended. */
export function alertText(
  alert: Alert,
  t: Dictionary['govOperations'],
): { tone: 'danger' | 'warning' | 'info'; title: string } {
  const template = t.alerts[alert.code];
  const values: Record<string, string | number> = {};
  if (alert.count !== undefined) values.count = alert.count;
  if (alert.officeCode !== undefined) values.office = alert.officeCode;
  if (alert.ref !== undefined) values.ref = alert.ref;

  let title = format(template, values);
  if (alert.officeCode !== undefined && !template.includes('{office}')) {
    title += format(t.alertOfficeSuffix, { office: alert.officeCode });
  }
  return { tone: TONES[alert.severity], title };
}
