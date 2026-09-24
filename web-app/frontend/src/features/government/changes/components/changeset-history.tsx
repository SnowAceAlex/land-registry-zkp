'use client';

/**
 * Every change set, newest first, with the buyers' archive (D77).
 *
 * Same shape as the issuance history (D42): the archive is the only surviving
 * copy of the buyers' secrets and is deleted after 7 days, so its expiry is
 * shown next to the button rather than discovered as a 410. A round that only
 * revoked has nothing to download.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { apiErrorCode } from '../../api/error-code';
import { type Failure, apiFailure } from '../../api/error-message';
import { govKeys } from '../../api/hooks';
import type { ChangeSetSummary } from '../../api/types';
import { downloadChangeSetArchive, listChangeSets } from '../api';

export function ChangeSetHistory({
  t,
  errors,
}: {
  t: Dictionary['govChanges'];
  errors: Dictionary['govErrors'];
}) {
  const changeSets = useQuery({ queryKey: govKeys.changeSets, queryFn: listChangeSets });
  const [downloading, setDownloading] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function download(changeSet: ChangeSetSummary) {
    setDownloading(changeSet.id);
    setFailure(null);
    try {
      await downloadChangeSetArchive(changeSet.id);
    } catch (error) {
      setFailure(
        apiErrorCode(error) === 'gone' ? { title: t.archiveGoneTitle } : apiFailure(error, errors),
      );
      await changeSets.refetch();
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="font-medium text-ink">{t.historyTitle}</h2>

      {failure ? (
        <Notice tone="danger" title={failure.title}>
          {failure.detail}
        </Notice>
      ) : null}

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
                const expired =
                  changeSet.archiveExpiresAt !== null &&
                  new Date(changeSet.archiveExpiresAt) < new Date();
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
                      {changeSet.status !== 'PUBLISHED' || changeSet.transferCount === 0 ? (
                        '—'
                      ) : expired ? (
                        <span className="text-xs text-steel">{t.archiveExpired}</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className={`${buttonStyles.secondary} px-3 py-1.5 text-xs`}
                            disabled={downloading !== null}
                            onClick={() => download(changeSet)}
                          >
                            {downloading === changeSet.id ? t.downloading : t.download}
                          </button>
                          {changeSet.archiveExpiresAt ? (
                            <span className="text-xs text-steel">
                              {format(t.archiveUntil, {
                                date: new Date(changeSet.archiveExpiresAt).toLocaleDateString(),
                              })}
                            </span>
                          ) : null}
                        </div>
                      )}
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
