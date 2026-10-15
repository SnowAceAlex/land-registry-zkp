'use client';

/** The open issuance requests (D87), each withdrawable until the round that publishes it. */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { type Failure, apiFailure } from '../../api/error-message';
import { govKeys } from '../../api/hooks';
import { listIssuanceRequests, withdrawIssuance } from '../api';

export function ReadyRequests({
  t,
  errors,
  onChanged,
}: {
  t: Dictionary['govIssuance'];
  errors: Dictionary['govErrors'];
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);

  const ready = useQuery({
    queryKey: govKeys.issuanceRequests('READY'),
    queryFn: () => listIssuanceRequests('READY'),
  });

  async function withdraw(id: number, propertyId: string) {
    setWorking(id);
    setFailure(null);
    setWithdrawn(null);
    try {
      await withdrawIssuance(id);
      setWithdrawn(propertyId);
    } catch (error) {
      setFailure(apiFailure(error, errors));
    } finally {
      setWorking(null);
      setConfirming(null);
      await onChanged();
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="font-medium text-ink">{t.readyTitle}</h2>

      {withdrawn ? (
        <Notice tone="success" title={format(t.withdrawnTitle, { id: withdrawn })} />
      ) : null}
      {failure ? (
        <Notice tone="danger" title={failure.title}>
          {failure.detail}
        </Notice>
      ) : null}

      {ready.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : ready.error ? (
        <Notice tone="danger" title={apiFailure(ready.error, errors).title} />
      ) : ready.data.length === 0 ? (
        <p className="py-2 text-sm text-steel">{t.readyEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t.columnProperty}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colOffice}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colCreated}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colAction}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              {ready.data.map((request) => (
                <tr key={request.id} className="align-top">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{request.propertyId}</span>
                    {request.held ? (
                      <span className="ml-2 rounded-full border border-hairline bg-zinc-50 px-2 py-0.5 text-xs text-steel">
                        {t.held}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {request.landOfficeCode ?? t.noOffice}
                  </td>
                  <td className="px-4 py-3 text-xs text-steel">
                    {new Date(request.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {confirming === request.id ? (
                      <div className="flex min-w-[16rem] flex-col gap-2">
                        <p className="text-xs text-ink">
                          {format(t.withdrawConfirm, { id: request.propertyId })}
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`${buttonStyles.primary} px-3 py-1.5 text-xs`}
                            disabled={working !== null}
                            onClick={() => void withdraw(request.id, request.propertyId)}
                          >
                            {working === request.id ? (
                              <>
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                {t.withdrawing}
                              </>
                            ) : (
                              t.withdrawConfirmButton
                            )}
                          </button>
                          <button
                            type="button"
                            className={`${buttonStyles.secondary} px-3 py-1.5 text-xs`}
                            disabled={working !== null}
                            onClick={() => setConfirming(null)}
                          >
                            {t.cancel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`${buttonStyles.secondary} px-3 py-1.5 text-xs`}
                        disabled={working !== null}
                        onClick={() => setConfirming(request.id)}
                      >
                        {t.withdraw}
                      </button>
                    )}
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
