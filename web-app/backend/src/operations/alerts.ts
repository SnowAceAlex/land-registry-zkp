import { Actor } from '../common/actor';

export const ALERT_CODES = [
  'ChainAheadOfDatabase',
  'PendingTransfersWouldBreak',
  'RevocationBacklog',
  'StaleQueueItem',
  'ArchiveNotDownloaded',
  'ArchiveExpiredUndownloaded',
  'UnassignedProperties',
  'HeldItems',
  'AuthorityRoleMissing',
  'AttesterRoleMissing',
] as const;

export type AlertCode = (typeof ALERT_CODES)[number];

export const ALERT_SEVERITIES = ['error', 'warning', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface Alert {
  code: AlertCode;
  severity: AlertSeverity;
  count?: number;
  officeCode?: string;
  /** RevocationBacklog: rounds needed. Archive alerts: the change set id. */
  ref?: number;
}

export interface OperationsSnapshot {
  chainRoot: string;
  dbLatestRoot: string | null;
  openDraftRoot: string | null;
  pendingTransfers: { officeCode: string | null; count: number }[];
  revocationsWaiting: number;
  revocationCap: number;
  staleItems: { officeCode: string | null; count: number }[];
  /** Not downloaded, expires within 2 days, not yet expired. */
  archivesNearExpiry: { officeCode: string; changeSetId: number }[];
  archivesExpiredUndownloaded: { officeCode: string; changeSetId: number }[];
  unassignedProperties: number;
  heldItems: number;
  authorityHasRole: boolean;
  attesterHasRole: boolean;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { error: 0, warning: 1, info: 2 };

// The empty registry has no DB row and the zero root on chain.
function chainAhead(s: OperationsSnapshot): boolean {
  if (s.dbLatestRoot === null && s.chainRoot === '0') return false;
  return s.chainRoot !== s.dbLatestRoot && s.chainRoot !== s.openDraftRoot;
}

const perOffice = (code: AlertCode, rows: { officeCode: string | null; count: number }[]) =>
  rows
    .filter((r) => r.count > 0)
    .map((r): Alert => ({
      code,
      severity: 'warning',
      count: r.count,
      ...(r.officeCode !== null && { officeCode: r.officeCode }),
    }));

// D89: alerts are codes derived from data; the portal words them, the backend never does.
export function deriveAlerts(s: OperationsSnapshot): Alert[] {
  const alerts: Alert[] = [];

  if (chainAhead(s)) alerts.push({ code: 'ChainAheadOfDatabase', severity: 'error' });
  if (!s.authorityHasRole) alerts.push({ code: 'AuthorityRoleMissing', severity: 'error' });
  if (!s.attesterHasRole) alerts.push({ code: 'AttesterRoleMissing', severity: 'error' });
  for (const a of s.archivesExpiredUndownloaded) {
    alerts.push({
      code: 'ArchiveExpiredUndownloaded',
      severity: 'error',
      officeCode: a.officeCode,
      ref: a.changeSetId,
    });
  }

  alerts.push(...perOffice('PendingTransfersWouldBreak', s.pendingTransfers));
  if (s.revocationsWaiting > s.revocationCap) {
    alerts.push({
      code: 'RevocationBacklog',
      severity: 'warning',
      count: s.revocationsWaiting,
      ref: Math.ceil(s.revocationsWaiting / s.revocationCap),
    });
  }
  alerts.push(...perOffice('StaleQueueItem', s.staleItems));
  for (const a of s.archivesNearExpiry) {
    alerts.push({
      code: 'ArchiveNotDownloaded',
      severity: 'warning',
      officeCode: a.officeCode,
      ref: a.changeSetId,
    });
  }

  if (s.unassignedProperties > 0) {
    alerts.push({ code: 'UnassignedProperties', severity: 'info', count: s.unassignedProperties });
  }
  if (s.heldItems > 0) alerts.push({ code: 'HeldItems', severity: 'info', count: s.heldItems });

  // Array.sort is stable, so the order above survives within a severity.
  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// D86: a branch sees alerts naming its own office, plus the registry-wide chain error.
export function alertsForActor(alerts: Alert[], actor: Actor): Alert[] {
  if (actor.scope === 'CENTRAL') return alerts;
  return alerts.filter(
    (a) => a.code === 'ChainAheadOfDatabase' || a.officeCode === actor.officeCode,
  );
}
