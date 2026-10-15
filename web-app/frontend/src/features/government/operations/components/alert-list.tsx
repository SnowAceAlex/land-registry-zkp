import type { Dictionary } from '@/i18n/dictionaries';
import { Notice } from '@/components/ui/notice';

import type { Alert } from '../../api/types';
import { alertText } from '../../api/alert-text';

export function AlertList({ alerts, t }: { alerts: Alert[]; t: Dictionary['govOperations'] }) {
  return (
    <section aria-labelledby="ops-alerts" className="space-y-3">
      <h2 id="ops-alerts" className="font-medium text-ink">{t.alertsTitle}</h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-steel">{t.alertsNone}</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert) => {
            const { tone, title } = alertText(alert, t);
            return (
              <li key={`${alert.code}:${alert.officeCode ?? ''}:${alert.ref ?? ''}`}>
                <Notice tone={tone} title={title} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
