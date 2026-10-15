import type { Alert } from '../../api/types';

export type RoundGate =
  | { state: 'blocked'; reasons: Alert[] }
  | { state: 'needs-ack'; reasons: Alert[] }
  | { state: 'clear' };

/** Whether a round may be created: errors block, warnings need a tick, info is ignored. */
export function roundGate(alerts: Alert[]): RoundGate {
  const errors = alerts.filter((alert) => alert.severity === 'error');
  if (errors.length > 0) return { state: 'blocked', reasons: errors };

  const warnings = alerts.filter((alert) => alert.severity === 'warning');
  if (warnings.length > 0) return { state: 'needs-ack', reasons: warnings };

  return { state: 'clear' };
}
