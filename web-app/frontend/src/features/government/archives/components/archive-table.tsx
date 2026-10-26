'use client';

import { Download } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { Button } from '@/components/ui/button';

import type { ArchiveSummary } from '../../api/types';
import { type ArchiveStatus, archiveStatus, expiredHintKind, timeLeft } from '../lib/archive-status';

type T = Dictionary['govArchives'];

const BADGE: Record<ArchiveStatus, string> = {
  waiting: 'border-hairline bg-zinc-50 text-steel',
  expiring: 'border-amber-200 bg-amber-50 text-amber-950',
  downloaded: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  expired: 'border-red-200 bg-red-50 text-red-900',
};

function expiresText(a: ArchiveSummary, now: Date, t: T): string {
  const left = timeLeft(a, now);
  if (!left) return t.expiredShort;
  if (left.days === 0 && left.hours === 0) return t.expiresUnderHour;
  return left.days > 0
    ? format(t.expiresDaysHours, { days: left.days, hours: left.hours })
    : format(t.expiresHours, { hours: left.hours });
}

/** One row per (round, office). A branch only ever receives its own rows from the backend. */
export function ArchiveTable({
  rows,
  showOffice,
  now,
  lang,
  t,
  downloading,
  onDownload,
}: {
  rows: ArchiveSummary[];
  showOffice: boolean;
  now: Date;
  lang: Locale;
  t: T;
  /** `changeSetId:officeCode` of the download in flight. */
  downloading: string | null;
  onDownload: (a: ArchiveSummary) => void;
}) {
  const numbers = new Intl.NumberFormat(lang);

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
      <table aria-label={t.tableLabel} className="w-full min-w-[52rem] text-left text-sm">
        <thead className="border-b border-hairline text-xs text-steel">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">{t.colRound}</th>
            <th scope="col" className="px-4 py-2 font-medium">{t.colPublished}</th>
            {showOffice ? <th scope="col" className="px-4 py-2 font-medium">{t.colOffice}</th> : null}
            <th scope="col" className="px-4 py-2 text-right font-medium">{t.colPlots}</th>
            <th scope="col" className="px-4 py-2 font-medium">{t.colExpires}</th>
            <th scope="col" className="px-4 py-2 font-medium">{t.colStatus}</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">{t.colAction}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-whisper">
          {rows.map((a) => {
            const status = archiveStatus(a, now);
            const key = `${a.changeSetId}:${a.officeCode}`;
            const busy = downloading === key;
            const fallback =
              a.firstDownloadedByOfficeCode !== null && a.firstDownloadedByOfficeCode !== a.officeCode;
            return (
              <tr key={key}>
                <td className="px-4 py-2 font-mono text-xs">
                  {format(t.roundLabel, { id: a.changeSetId })}
                  {a.rootVersion !== null ? ` · ${format(t.versionLabel, { version: a.rootVersion })}` : ''}
                </td>
                <td className="px-4 py-2 text-xs text-steel">
                  {a.publishedAt ? new Date(a.publishedAt).toLocaleString(lang) : t.noValue}
                </td>
                {showOffice ? (
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{a.officeCode}</span>
                    <span className="ml-2 text-steel">{a.officeName}</span>
                  </td>
                ) : null}
                <td className="px-4 py-2 text-right font-mono text-xs">{numbers.format(a.propertyCount)}</td>
                <td className="px-4 py-2 text-xs text-steel">{expiresText(a, now, t)}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${BADGE[status]}`}>
                    {t.status[status]}
                  </span>
                  {a.firstDownloadedAt ? (
                    <p className="mt-1 text-xs text-steel">
                      {format(t.firstDownloaded, { date: new Date(a.firstDownloadedAt).toLocaleString(lang) })}
                      {fallback
                        ? ` ${format(t.downloadedByOther, { office: a.firstDownloadedByOfficeCode! })}`
                        : ''}
                    </p>
                  ) : null}
                  {status === 'expired' ? (
                    <p className="mt-1 text-xs text-steel">
                      {expiredHintKind(a) === 'reissue' ? t.expiredHint : t.expiredHintNeutral}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="secondary"
                    disabled={status === 'expired' || downloading !== null}
                    aria-busy={busy}
                    onClick={() => onDownload(a)}
                  >
                    <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    {busy ? t.downloading : t.download}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
