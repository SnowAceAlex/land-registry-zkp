import type { Dictionary } from '@/i18n/dictionaries';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { format } from '@/i18n/format';

import type { Alert } from '../../api/types';
import { alertGroupText, groupAlerts } from '../../api/alert-text';

export function AlertList({
  alerts,
  t,
  onAcknowledge,
  acknowledging = null,
}: {
  alerts: Alert[];
  t: Dictionary['govOperations'];
  /** Central only (D92); absent for a branch, which then sees no button. */
  onAcknowledge?: (ref: number) => void;
  /** The round whose acknowledgement is in flight. */
  acknowledging?: number | null;
}) {
  return (
    <section aria-labelledby="ops-alerts" className="space-y-3">
      <h2 id="ops-alerts" className="font-medium text-ink">{t.alertsTitle}</h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-steel">{t.alertsNone}</p>
      ) : (
        <ul className="space-y-2">
          {groupAlerts(alerts).map((group) => {
            const { alert } = group;
            const { tone, title, detail } = alertGroupText(group, t);
            const ref = alert.ref;
            const action =
              onAcknowledge && alert.code === 'ArchiveExpiredUndownloaded' && ref !== undefined ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={acknowledging !== null}
                  aria-label={format(t.archiveAckLabel, { ref })}
                  onClick={() => onAcknowledge(ref)}
                >
                  {acknowledging === ref ? t.archiveAckPending : t.archiveAck}
                </Button>
              ) : undefined;
            return (
              <li key={`${alert.code}:${alert.officeCode ?? ''}:${alert.ref ?? ''}`}>
                <Notice tone={tone} title={title} action={action}>
                  {detail}
                </Notice>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
