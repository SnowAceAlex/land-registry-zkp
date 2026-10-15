'use client';

/**
 * Every open item of the three procedures, with Hold / Release (D87). A held
 * item stays an open procedure but is left out of the next round. The office
 * and kind filters start from the query string the operations page links with.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { type Failure, apiFailure } from '../../api/error-message';
import { govKeys, useQueue } from '../../api/hooks';
import type { QueueFilter, QueueItem, QueueKind } from '../../api/types';
import { holdQueueItem, releaseQueueItem } from '../api';

type Strings = Dictionary['govChanges'];

const PAGE_SIZE = 25;
const KINDS: QueueKind[] = ['issuance', 'transfer', 'revocation'];
const KIND_LABEL = {
  issuance: 'kindIssuance',
  transfer: 'kindTransfer',
  revocation: 'kindRevocation',
} as const satisfies Record<QueueKind, keyof Strings>;

const isKind = (value: string | null): value is QueueKind => KINDS.includes(value as QueueKind);

const itemKey = (item: Pick<QueueItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`;

function age(hours: number, t: Strings): string {
  return hours < 48
    ? format(t.ageHours, { hours })
    : format(t.ageDays, { days: Math.floor(hours / 24) });
}

export function QueueTable({ t, errors }: { t: Strings; errors: Dictionary['govErrors'] }) {
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const initialKind = params.get('kind');
  const [kind, setKind] = useState<QueueKind | ''>(isKind(initialKind) ? initialKind : '');
  const [office, setOffice] = useState(params.get('office') ?? '');
  const [applied, setApplied] = useState<{ kind: QueueKind | ''; office: string }>({ kind, office });
  const [skip, setSkip] = useState(0);

  const [holding, setHolding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const filter: QueueFilter = {
    kind: applied.kind || undefined,
    officeCode: applied.office.trim().toUpperCase() || undefined,
    skip,
    take: PAGE_SIZE,
  };
  const queue = useQueue(filter);

  async function run(item: QueueItem, action: () => Promise<unknown>) {
    setBusy(itemKey(item));
    setFailure(null);
    try {
      await action();
      setHolding(null);
      setReason('');
    } catch (error) {
      setFailure(apiFailure(error, errors));
    } finally {
      setBusy(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gov', 'queue'] }),
        queryClient.invalidateQueries({ queryKey: govKeys.pendingChanges }),
        queryClient.invalidateQueries({ queryKey: govKeys.overview }),
        queryClient.invalidateQueries({ queryKey: govKeys.offices }),
      ]);
    }
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    setApplied({ kind, office });
    setSkip(0);
  }

  const total = queue.data?.total ?? 0;

  return (
    <section className="space-y-4" aria-labelledby="round-queue">
      <h2 id="round-queue" className="font-medium text-ink">
        {t.queueTitle}
      </h2>

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="queue-kind" className="block text-xs text-steel">
            {t.filterKind}
          </label>
          <select
            id="queue-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as QueueKind | '')}
            className="mt-1 rounded-lg border border-hairline bg-white px-3 py-2 text-sm"
          >
            <option value="">{t.filterAllKinds}</option>
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {t[KIND_LABEL[value]]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="queue-office" className="block text-xs text-steel">
            {t.filterOffice}
          </label>
          <input
            id="queue-office"
            value={office}
            onChange={(event) => setOffice(event.target.value)}
            placeholder={t.filterOfficePlaceholder}
            className="mt-1 w-32 rounded-lg border border-hairline bg-white px-3 py-2 font-mono text-sm"
          />
        </div>
        <button type="submit" className={buttonStyles.secondary}>
          {t.filterApply}
        </button>
      </form>

      {failure ? (
        <Notice tone="danger" title={failure.title}>
          {failure.detail}
        </Notice>
      ) : null}

      {queue.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : queue.error ? (
        <Notice tone="danger" title={t.queueLoadError} />
      ) : queue.data.items.length === 0 ? (
        <p className="text-sm text-steel">{t.queueEmpty}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-hairline text-xs text-steel">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colKind}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colItem}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colProperty}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colOffice}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colFiledBy}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colAge}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colStatus}</th>
                  <th scope="col" className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-whisper">
                {queue.data.items.map((item) => {
                  const key = itemKey(item);
                  return (
                    <QueueRows
                      key={key}
                      item={item}
                      t={t}
                      working={busy === key}
                      anyBusy={busy !== null}
                      holding={holding === key}
                      reason={reason}
                      onReason={setReason}
                      onStartHold={() => {
                        setHolding(key);
                        setReason('');
                      }}
                      onCancelHold={() => setHolding(null)}
                      onHold={() => run(item, () => holdQueueItem(item.kind, item.id, reason.trim()))}
                      onRelease={() => run(item, () => releaseQueueItem(item.kind, item.id))}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-steel">
            <span>
              {format(t.queueRange, {
                from: skip + 1,
                to: skip + queue.data.items.length,
                total,
              })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonStyles.secondary}
                disabled={skip === 0}
                onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              >
                {t.prev}
              </button>
              <button
                type="button"
                className={buttonStyles.secondary}
                disabled={skip + PAGE_SIZE >= total}
                onClick={() => setSkip(skip + PAGE_SIZE)}
              >
                {t.next}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function QueueRows({
  item,
  t,
  working,
  anyBusy,
  holding,
  reason,
  onReason,
  onStartHold,
  onCancelHold,
  onHold,
  onRelease,
}: {
  item: QueueItem;
  t: Strings;
  working: boolean;
  anyBusy: boolean;
  holding: boolean;
  reason: string;
  onReason: (value: string) => void;
  onStartHold: () => void;
  onCancelHold: () => void;
  onHold: () => void;
  onRelease: () => void;
}) {
  return (
    <>
      <tr className="align-top">
        <td className="px-4 py-2">{t[KIND_LABEL[item.kind]]}</td>
        <td className="px-4 py-2 font-mono text-xs">#{item.id}</td>
        <td className="px-4 py-2 font-mono text-xs">{item.propertyId}</td>
        <td className="px-4 py-2 font-mono text-xs">{item.landOfficeCode ?? t.unassigned}</td>
        <td className="px-4 py-2 font-mono text-xs">
          {item.officeCode ?? '—'}
          {item.byFallback ? (
            <span className="ml-2 font-sans text-steel">
              {format(t.fallbackMark, { office: item.landOfficeCode ?? t.unassigned })}
            </span>
          ) : null}
        </td>
        <td className="px-4 py-2 text-xs text-steel">{age(item.ageHours, t)}</td>
        <td className="px-4 py-2">
          {item.held ? t.stateHeld : t.stateWaiting}
          {item.held && item.heldReason ? (
            <p className="mt-0.5 max-w-[16rem] break-words text-xs text-steel">{item.heldReason}</p>
          ) : null}
        </td>
        <td className="px-4 py-2 text-right">
          {item.held ? (
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={anyBusy}
              onClick={onRelease}
            >
              {t.release}
            </button>
          ) : (
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={anyBusy || holding}
              onClick={onStartHold}
            >
              {t.hold}
            </button>
          )}
        </td>
      </tr>
      {holding ? (
        <tr>
          <td colSpan={8} className="bg-whisper/40 px-4 py-3">
            <label htmlFor={`hold-${item.kind}-${item.id}`} className="block text-xs text-steel">
              {t.holdReasonLabel}
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              <input
                id={`hold-${item.kind}-${item.id}`}
                value={reason}
                maxLength={500}
                onChange={(event) => onReason(event.target.value)}
                className="min-w-[16rem] flex-1 rounded-lg border border-hairline bg-white px-3 py-2 text-sm"
              />
              <button
                type="button"
                className={buttonStyles.primary}
                disabled={working || reason.trim().length === 0}
                onClick={onHold}
              >
                {t.hold}
              </button>
              <button
                type="button"
                className={buttonStyles.secondary}
                disabled={working}
                onClick={onCancelHold}
              >
                {t.holdCancel}
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
