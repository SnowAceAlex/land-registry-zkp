'use client';

/**
 * The revocations already queued for the next change set (D45/D46). Same data
 * as the Changes page's queue — one query key — so a request queued by the
 * form above shows up here immediately.
 */

import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

import { usePendingChanges } from '../../api/hooks';

type Strings = Dictionary['govRevocations'];

const reasonLabel = (t: Strings, code: number) =>
  code >= 1 && code <= 5 ? t[`reason${code as 1 | 2 | 3 | 4 | 5}`] : String(code);

export function PendingRevocations({ t }: { t: Strings }) {
  const pending = usePendingChanges();

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium text-ink">{t.pendingTitle}</h2>
        {pending.data && pending.data.revocations.length > pending.data.revocationCap ? (
          <p className="mt-1 text-sm text-steel">
            {format(t.capNote, { cap: pending.data.revocationCap })}
          </p>
        ) : null}
      </div>

      {pending.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : pending.error ? (
        <Notice tone="danger" title={t.loadError} />
      ) : pending.data.revocations.length === 0 ? (
        <p className="text-sm text-steel">{t.pendingEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t.colProperty}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colReason}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colDetail}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colDetailHash}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colRequested}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              {pending.data.revocations.map((revocation) => (
                <tr key={revocation.id} className="align-top">
                  <td className="px-4 py-2 font-mono text-xs">{revocation.propertyId}</td>
                  <td className="px-4 py-2">{reasonLabel(t, revocation.reasonCode)}</td>
                  <td className="max-w-[16rem] px-4 py-2 break-words text-ink">{revocation.detailText}</td>
                  <td className="px-4 py-2">
                    <HashText value={revocation.detailHash} />
                  </td>
                  <td className="px-4 py-2 text-xs text-steel">
                    {new Date(revocation.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
