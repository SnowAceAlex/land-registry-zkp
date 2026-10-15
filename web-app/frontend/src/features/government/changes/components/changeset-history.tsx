'use client';

/**
 * Every change set, newest first. Archives are per office now (D88); the
 * download moves to the archives page, so this table only counts them.
 */

import { useQuery } from '@tanstack/react-query';

import type { Dictionary } from '@/i18n/dictionaries';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { apiFailure } from '../../api/error-message';
import { govKeys } from '../../api/hooks';
import { listChangeSets } from '../api';

export function ChangeSetHistory({
  t,
  errors,
}: {
  t: Dictionary['govChanges'];
  errors: Dictionary['govErrors'];
}) {
  const changeSets = useQuery({ queryKey: govKeys.changeSets, queryFn: listChangeSets });
  return (
    <section className="space-y-4">
      <h2 className="font-medium text-ink">{t.historyTitle}</h2>

      {changeSets.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : changeSets.error ? (
        <Notice tone="danger" title={apiFailure(changeSets.error, errors).title} />
      ) : changeSets.data.length === 0 ? (
        <p className="text-sm text-steel">{t.historyEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t.colChangeSet}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colStatus}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colTransfers}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colRevocations}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colRootVersion}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colTransaction}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colPublished}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colArchive}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              {changeSets.data.map((changeSet) => {
                return (
                  <tr key={changeSet.id} className="align-middle">
                    <td className="px-4 py-2 font-mono text-xs">#{changeSet.id}</td>
                    <td className="px-4 py-2">{t[`status${changeSet.status}`]}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{changeSet.transferCount}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{changeSet.revocationCount}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {changeSet.rootVersion !== null ? `v${changeSet.rootVersion}` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {changeSet.txHash ? <HashText value={changeSet.txHash} /> : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-steel">
                      {changeSet.publishedAt ? new Date(changeSet.publishedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {changeSet.archiveCount === 0
                        ? '—'
                        : `${changeSet.archivesDownloaded}/${changeSet.archiveCount}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
