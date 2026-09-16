'use client';

/**
 * UC-3 approval queue. Approval is the step that needs a person (D28): a
 * transfer proof shows someone holds the seller's secret, not that they ARE
 * the seller. Approving verifies the proof on chain and moves the request to
 * APPROVED; publishing happens later, batched in a change set (D46).
 *
 * The rejection reasons that matter get their own explanation:
 *   - RootMismatch — the registry published a new root after the proof was
 *     made; the backend already auto-rejected the request, so the parties must
 *     come back;
 *   - StaleTimestamp — the proof's time is outside the ±10 min window; on a
 *     local hardhat node this is usually an idle chain with an old block time.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { apiErrorCode, errorDetail } from '../../api/error-code';
import { apiFailure } from '../../api/error-message';
import { govKeys } from '../../api/hooks';
import type { TransferRequest, TransferStatus } from '../../api/types';
import { approveTransfer, downloadBuyerBundle, listTransfers, rejectTransfer } from '../api';

const TABS: TransferStatus[] = ['PENDING', 'APPROVED', 'PUBLISHED', 'REJECTED'];

type Message = { tone: 'success' | 'danger'; title: string; detail?: string; hint?: string };

export function TransferQueue({
  t,
  errors,
}: {
  t: Dictionary['govTransfers'];
  errors: Dictionary['govErrors'];
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TransferStatus>('PENDING');
  const [working, setWorking] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<{ id: number; reason: string } | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const transfers = useQuery({
    queryKey: govKeys.transfers(tab),
    queryFn: () => listTransfers(tab),
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['gov', 'transfers'] }),
      queryClient.invalidateQueries({ queryKey: govKeys.pendingChanges }),
    ]);
  }

  function failureMessage(error: unknown): Message {
    const failure = apiFailure(error, errors);
    const code = apiErrorCode(error);
    return {
      tone: 'danger',
      ...failure,
      hint:
        code === 'root-mismatch'
          ? t.rootMismatchHint
          : code === 'stale-timestamp'
            ? t.staleTimestampHint
            : undefined,
    };
  }

  async function run(id: number, action: () => Promise<unknown>, success: string) {
    setWorking(id);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', title: success });
    } catch (error) {
      setMessage(failureMessage(error));
    } finally {
      setWorking(null);
      setRejecting(null);
      await refresh();
    }
  }

  async function download(request: TransferRequest) {
    setWorking(request.id);
    setMessage(null);
    try {
      await downloadBuyerBundle(request.id);
    } catch (error) {
      setMessage({ tone: 'danger', title: t.bundleTitle, detail: errorDetail(error) });
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t.queueTitle} className="flex flex-wrap gap-1 border-b border-whisper">
        {TABS.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            onClick={() => {
              setTab(status);
              setMessage(null);
              setRejecting(null);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ui-transition ${
              tab === status
                ? 'border-authority text-ink'
                : 'border-transparent text-steel hover:text-ink'
            }`}
          >
            {t[`tab${status}`]}
          </button>
        ))}
      </div>

      {message ? (
        <Notice tone={message.tone} title={message.title}>
          {message.detail}
          {message.hint ? <p className="mt-2 font-medium">{message.hint}</p> : null}
        </Notice>
      ) : null}

      {transfers.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : transfers.error ? (
        <Notice tone="danger" title={errors.unknown}>
          {errorDetail(transfers.error)}
        </Notice>
      ) : transfers.data.length === 0 ? (
        <p className="py-6 text-sm text-steel">{t.queueEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t.colRequest}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colProperty}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colBuyer}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colCreated}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colDecided}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colAction}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              {transfers.data.map((request) => (
                <tr key={request.id} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs">#{request.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{request.propertyId}</td>
                  <td className="px-4 py-3">
                    <HashText value={request.newOwnerCommitment} />
                  </td>
                  <td className="px-4 py-3 text-xs text-steel">
                    {new Date(request.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs text-steel">
                    {request.decidedAt ? new Date(request.decidedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {request.status === 'PENDING' ? (
                      rejecting?.id === request.id ? (
                        <div className="flex min-w-[16rem] flex-col gap-2">
                          <label htmlFor={`reject-${request.id}`} className="text-xs font-medium text-ink">
                            {format(t.rejectReason, { id: request.id })}
                          </label>
                          <input
                            id={`reject-${request.id}`}
                            maxLength={500}
                            value={rejecting.reason}
                            onChange={(event) => setRejecting({ id: request.id, reason: event.target.value })}
                            className="w-full rounded-lg border border-hairline px-3 py-2 text-sm ui-transition focus:border-authority"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={`${buttonStyles.primary} px-3 py-1.5 text-xs`}
                              disabled={working !== null}
                              onClick={() =>
                                run(
                                  request.id,
                                  () => rejectTransfer(request.id, rejecting.reason.trim() || undefined),
                                  format(t.rejectedTitle, { id: request.id }),
                                )
                              }
                            >
                              {t.confirmReject}
                            </button>
                            <button
                              type="button"
                              className={`${buttonStyles.secondary} px-3 py-1.5 text-xs`}
                              onClick={() => setRejecting(null)}
                            >
                              {t.cancel}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={`${buttonStyles.primary} px-3 py-1.5 text-xs`}
                            disabled={working !== null}
                            onClick={() =>
                              run(
                                request.id,
                                () => approveTransfer(request.id),
                                format(t.approvedTitle, { id: request.id }),
                              )
                            }
                          >
                            {working === request.id ? (
                              <>
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                {t.approving}
                              </>
                            ) : (
                              t.approve
                            )}
                          </button>
                          <button
                            type="button"
                            className={`${buttonStyles.secondary} px-3 py-1.5 text-xs`}
                            disabled={working !== null}
                            onClick={() => setRejecting({ id: request.id, reason: '' })}
                          >
                            {t.reject}
                          </button>
                        </div>
                      )
                    ) : request.status === 'APPROVED' ? (
                      <span className="text-xs text-steel">{t.awaitingPublication}</span>
                    ) : request.status === 'PUBLISHED' ? (
                      <button
                        type="button"
                        className={`${buttonStyles.secondary} px-3 py-1.5 text-xs`}
                        disabled={working !== null}
                        onClick={() => download(request)}
                      >
                        {t.downloadBundle}
                      </button>
                    ) : (
                      <span className="text-xs text-steel">{request.rejectReason ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
