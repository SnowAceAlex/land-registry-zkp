'use client';

/**
 * Every issuance round, newest first, with its archive (D42).
 *
 * The archive is the only surviving copy of the round's owner secrets and is
 * deleted after 7 days, so its expiry is shown next to the button rather than
 * discovered as a 410 after the fact.
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
import type { IssuanceBatchSummary } from '../../api/types';
import { downloadIssuanceArchive, listIssuanceBatches } from '../api';

export function BatchHistory({
  t,
  errors,
}: {
  t: Dictionary['govIssuance'];
  errors: Dictionary['govErrors'];
}) {
  const batches = useQuery({ queryKey: govKeys.issuanceBatches, queryFn: listIssuanceBatches });
  const [downloading, setDownloading] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function download(batch: IssuanceBatchSummary) {
    setDownloading(batch.id);
    setFailure(null);
    try {
      await downloadIssuanceArchive(batch.id);
    } catch (error) {
      setFailure(
        apiErrorCode(error) === 'gone'
          ? { title: t.archiveGoneTitle }
          : apiFailure(error, errors),
      );
      await batches.refetch();
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

      {batches.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : batches.error ? (
        <Notice tone="danger" title={apiFailure(batches.error, errors).title} />
      ) : batches.data.length === 0 ? (
        <p className="text-sm text-steel">{t.historyEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t.colBatch}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colStatus}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colProperties}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colRootVersion}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colTransaction}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colPublished}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colArchive}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              {batches.data.map((batch) => {
                const expired =
                  batch.archiveExpiresAt !== null && new Date(batch.archiveExpiresAt) < new Date();
                return (
                  <tr key={batch.id} className="align-middle">
                    <td className="px-4 py-2 font-mono text-xs">#{batch.id}</td>
                    <td className="px-4 py-2">{t[`status${batch.status}`]}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{batch.propertyCount}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {batch.rootVersion !== null ? `v${batch.rootVersion}` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {batch.txHash ? <HashText value={batch.txHash} /> : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-steel">
                      {batch.publishedAt ? new Date(batch.publishedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {batch.status !== 'PUBLISHED' ? (
                        '—'
                      ) : expired ? (
                        <span className="text-xs text-steel">{t.archiveExpired}</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className={`${buttonStyles.secondary} px-3 py-1.5 text-xs`}
                            disabled={downloading !== null}
                            onClick={() => download(batch)}
                          >
                            {downloading === batch.id ? t.downloading : t.download}
                          </button>
                          {batch.archiveExpiresAt ? (
                            <span className="text-xs text-steel">
                              {format(t.archiveUntil, {
                                date: new Date(batch.archiveExpiresAt).toLocaleDateString(),
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
