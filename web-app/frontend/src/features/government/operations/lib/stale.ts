import type { Alert } from '../../api/types';

/** Whether the alerts flag stale queue items for this office (null = the unassigned plots). */
export function isOfficeStale(alerts: Alert[], officeCode: string | null): boolean {
  return alerts.some((a) => a.code === 'StaleQueueItem' && (a.officeCode ?? null) === officeCode);
}
