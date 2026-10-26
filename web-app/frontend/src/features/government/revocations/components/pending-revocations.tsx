'use client';

/**
 * The revocations already queued for the next round (D45/D46). Same data
 * as the register-closing page's queue — one query key — so a request queued
 * by the form above shows up here immediately. The plot's branch or a central office
 * can withdraw one before the round that publishes it (D87).
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';

import { buttonStyles } from '@/components/ui/button';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { useConfirmFocus } from '@/lib/use-confirm-focus';

import { type Failure, apiFailure } from '../../api/error-message';
import { govKeys, useMe, usePendingChanges } from '../../api/hooks';
import { withdrawRevocation } from '../api';
import { canWithdrawRevocation } from '../lib/can-withdraw';

type Strings = Dictionary['govRevocations'];

const reasonLabel = (t: Strings, code: number) =>
  code >= 1 && code <= 5 ? t[`reason${code as 1 | 2 | 3 | 4 | 5}`] : String(code);

export function PendingRevocations({ t, errors }: { t: Strings; errors: Dictionary['govErrors'] }) {
  const queryClient = useQueryClient();
  const pending = usePendingChanges();
  const me = useMe();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);
  const { confirmRef, triggerRef } = useConfirmFocus(confirming);

  async function withdraw(id: number, propertyId: string) {
    setWorking(id);
    setFailure(null);
    setWithdrawn(null);
    try {
      await withdrawRevocation(id);
      setWithdrawn(propertyId);
    } catch (error) {
      setFailure(apiFailure(error, errors));
    } finally {
      setWorking(null);
      setConfirming(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: govKeys.pendingChanges }),
        queryClient.invalidateQueries({ queryKey: govKeys.queueAll }),
        queryClient.invalidateQueries({ queryKey: govKeys.overview }),
      ]);
    }
  }

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

      {withdrawn ? (
        <Notice tone="success" title={format(t.withdrawnTitle, { id: withdrawn })} />
      ) : null}
      {failure ? (
        <Notice tone="danger" title={failure.title}>
          {failure.detail}
        </Notice>
      ) : null}

      {pending.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : pending.error ? (
        <Notice tone="danger" title={t.loadError} />
      ) : pending.data.revocations.length === 0 ? (
        <p className="text-sm text-steel">{t.pendingEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t.colProperty}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t.colOffice}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t.colReason}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t.colDetail}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t.colDetailHash}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t.colRequested}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t.colAction}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              {pending.data.revocations.map((revocation) => (
                <tr key={revocation.id} className="align-top">
                  <td className="px-4 py-2 font-mono text-xs">{revocation.propertyId}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className="font-mono">{revocation.landOfficeCode ?? t.noOffice}</span>
                    {revocation.byFallback ? (
                      <span className="mt-1 block w-fit rounded-full border border-hairline bg-zinc-50 px-2 py-0.5 text-steel">
                        {format(t.fallbackBadge, { office: revocation.officeCode ?? t.noOffice })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">{reasonLabel(t, revocation.reasonCode)}</td>
                  <td className="max-w-[16rem] px-4 py-2 break-words text-ink">
                    {revocation.detailText}
                  </td>
                  <td className="px-4 py-2">
                    <HashText value={revocation.detailHash} />
                  </td>
                  <td className="px-4 py-2 text-xs text-steel">
                    {new Date(revocation.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    {!canWithdrawRevocation(me.data, revocation) ? null : confirming ===
                      revocation.id ? (
                      <div className="flex min-w-[16rem] flex-col gap-2">
                        <p className="text-xs text-ink">
                          {format(t.withdrawConfirm, { id: revocation.propertyId })}
                        </p>
                        <div className="flex gap-2">
                          <button
                            ref={confirmRef}
                            type="button"
                            className={`${buttonStyles.primary} px-3 py-1.5 text-xs`}
                            disabled={working !== null}
                            onClick={() => void withdraw(revocation.id, revocation.propertyId)}
                          >
                            {working === revocation.id ? (
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
                        ref={triggerRef(revocation.id)}
                        type="button"
                        className={`${buttonStyles.secondary} px-3 py-1.5 text-xs`}
                        disabled={working !== null}
                        onClick={() => setConfirming(revocation.id)}
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
