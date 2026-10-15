import type { Alert, AlertCode } from '../../api/types';

export type RoundGate =
  | { state: 'blocked'; reasons: Alert[] }
  | { state: 'needs-ack'; reasons: Alert[] }
  | { state: 'clear' };

/** Only round-safety alerts block; an operational error (e.g. an expired archive) never clears by itself. */
export const ROUND_BLOCKING_CODES: readonly AlertCode[] = ['ChainAheadOfDatabase'];

/** Whether a round may be created: blocking codes block, other errors and warnings need a tick, info is ignored. */
export function roundGate(alerts: Alert[]): RoundGate {
  const blocking = alerts.filter((alert) => ROUND_BLOCKING_CODES.includes(alert.code));
  if (blocking.length > 0) return { state: 'blocked', reasons: blocking };

  const toAck = alerts.filter((alert) => alert.severity === 'error' || alert.severity === 'warning');
  if (toAck.length > 0) return { state: 'needs-ack', reasons: toAck };

  return { state: 'clear' };
}

/** Identifies a set of alerts with their counts, so a tick applies only to what the officer saw. */
export function ackSignature(reasons: Alert[]): string {
  return reasons
    .map(
      (alert) => `${alert.code}:${alert.officeCode ?? ''}:${alert.ref ?? ''}:${alert.count ?? ''}`,
    )
    .sort()
    .join('|');
}
