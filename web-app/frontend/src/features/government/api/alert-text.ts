import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

import type { Alert, AlertCode } from './types';

/** The slice of the operations dictionary that words an alert. */
export type AlertStrings = Pick<Dictionary['govOperations'], 'alerts' | 'alertsGrouped' | 'alertNoOffice'>;

type Tone = 'danger' | 'warning' | 'info';
const TONES = { error: 'danger', warning: 'warning', info: 'info' } as const;

// The backend sends archive alerts one per office; on screen they merge per round (D92).
const PER_ROUND = ['ArchiveNotDownloaded', 'ArchiveExpiredUndownloaded'] as const satisfies readonly AlertCode[];
type PerRoundCode = (typeof PER_ROUND)[number];
const isPerRound = (code: AlertCode): code is PerRoundCode =>
  (PER_ROUND as readonly AlertCode[]).includes(code);

/** Words a coded alert (D89); an alert with no office speaks of the unassigned plots. */
export function alertText(alert: Alert, t: AlertStrings): { tone: Tone; title: string } {
  const template = t.alerts[alert.code];
  const values: Record<string, string | number> = { office: alert.officeCode ?? t.alertNoOffice };
  if (alert.count !== undefined) values.count = alert.count;
  if (alert.ref !== undefined) values.ref = alert.ref;

  return { tone: TONES[alert.severity], title: format(template, values) };
}

/** One line on screen: an alert and every office it stands for. */
export interface AlertGroup {
  alert: Alert;
  officeCodes: string[];
}

/** Merges the per-office archive alerts of one round; every other alert stays as it is, in order. */
export function groupAlerts(alerts: Alert[]): AlertGroup[] {
  const groups: AlertGroup[] = [];
  const rounds = new Map<string, AlertGroup>();
  for (const alert of alerts) {
    const office = alert.officeCode;
    const group: AlertGroup = { alert, officeCodes: office === undefined ? [] : [office] };
    if (!isPerRound(alert.code) || office === undefined) {
      groups.push(group);
      continue;
    }
    const key = `${alert.code}:${alert.ref}`;
    const existing = rounds.get(key);
    if (existing) {
      existing.officeCodes.push(office);
    } else {
      rounds.set(key, group);
      groups.push(group);
    }
  }
  for (const group of rounds.values()) group.officeCodes.sort();
  return groups;
}

/** One office reads as alertText; several give their count, and `detail` lists them. */
export function alertGroupText(
  group: AlertGroup,
  t: AlertStrings,
): { tone: Tone; title: string; detail?: string } {
  const { alert, officeCodes } = group;
  if (officeCodes.length < 2 || !isPerRound(alert.code)) return alertText(alert, t);
  return {
    tone: TONES[alert.severity],
    title: format(t.alertsGrouped[alert.code], { ref: alert.ref ?? '', count: officeCodes.length }),
    detail: officeCodes.join(', '),
  };
}
