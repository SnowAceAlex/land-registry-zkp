'use client';

/**
 * Request a revocation (D45). The request only queues: the plot leaves the
 * tree — and the reason reaches the chain — when the next change set publishes.
 *
 * What the officer types is deliberately not what the chain stores. The reason
 * is a uint8 code; the free-text detail is hashed (keccak256) and the text
 * stays in the database, off the public history too (D48). "Revoked over an
 * inheritance dispute" published permanently is a different matter from a
 * revoked diploma.
 *
 * D80: freeze the owner on chain before the request exists — the backend refuses it otherwise.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';

import { type Failure, apiFailure } from '../../api/error-message';
import { govKeys } from '../../api/hooks';
import { getFreezeStatus } from '../../api/freezes';
import type { FreezeStatus } from '../../api/types';
import { openProcedureMessage } from '../../publishing/open-procedure-message';
import { FreezeStep } from '../../publishing/components/freeze-step';
import { UnfreezeAction } from '../../publishing/components/unfreeze-action';
import { requestRevocation } from '../api';

const REASON_CODES = [1, 2, 3, 4, 5] as const;
const DETAIL_LIMIT = 500;

export function RevocationForm({
  t,
  errors,
  freezeT,
}: {
  t: Dictionary['govRevocations'];
  errors: Dictionary['govErrors'];
  freezeT: Dictionary['govFreeze'];
}) {
  const queryClient = useQueryClient();
  const [propertyId, setPropertyId] = useState('');
  const [reasonCode, setReasonCode] = useState<number>(1);
  const [detail, setDetail] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [queued, setQueued] = useState<{ propertyId: string; detailHash: string } | null>(null);
  const [pendingFreeze, setPendingFreeze] = useState<FreezeStatus | null>(null);
  /** A plot frozen for a request that then failed to record — offered for unfreeze (D80). */
  const [abandonable, setAbandonable] = useState<string | null>(null);
  // F3: what gets recorded — captured at submit time, not re-read from the live form.
  const [captured, setCaptured] = useState<{
    propertyId: string;
    reasonCode: number;
    detailText: string;
  } | null>(null);

  const propertyInvalid = !/^\d+$/.test(propertyId.trim());
  const detailInvalid = detail.trim().length === 0;

  /** Record the request — only reached once the chain freezes the owner. */
  async function record(target: { propertyId: string; reasonCode: number; detailText: string }) {
    const result = await requestRevocation(target);
    setQueued({ propertyId: result.propertyId, detailHash: result.detailHash });
    setPropertyId('');
    setDetail('');
    setTouched(false);
    await queryClient.invalidateQueries({ queryKey: govKeys.pendingChanges });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (propertyInvalid || detailInvalid || submitting) return;

    setSubmitting(true);
    setFailure(null);
    setQueued(null);
    setPendingFreeze(null);
    setAbandonable(null);
    const target = { propertyId: propertyId.trim(), reasonCode, detailText: detail.trim() };
    let frozenTarget: string | null = null;
    try {
      const status = await getFreezeStatus(target.propertyId);
      if (status.openProcedure) {
        setFailure({ title: openProcedureMessage(freezeT, status.openProcedure) });
      } else if (status.frozenOnChain) {
        // Already frozen — a retry after a request that failed post-freeze.
        frozenTarget = target.propertyId;
        await record(target);
      } else {
        setCaptured(target);
        setPendingFreeze(status);
      }
    } catch (error) {
      setFailure(apiFailure(error, errors));
      // Frozen but not recorded: fail-safe, yet the officer may want it lifted.
      if (frozenTarget) setAbandonable(frozenTarget);
    } finally {
      setSubmitting(false);
    }
  }

  async function frozen() {
    if (!pendingFreeze || !captured) return;
    const targetId = pendingFreeze.propertyId;
    setPendingFreeze(null);
    setSubmitting(true);
    try {
      await record(captured);
    } catch (error) {
      setFailure(apiFailure(error, errors));
      setAbandonable(targetId);
    } finally {
      setSubmitting(false);
      setCaptured(null);
    }
  }

  return (
    <>
    <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-hairline bg-white p-5 sm:p-6">
      <div>
        <h2 className="font-medium text-ink">{t.revokeTitle}</h2>
        <p className="mt-1 max-w-prose text-sm text-steel">{t.revokeBody}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div>
          <label htmlFor="revoke-property" className="block text-sm font-medium text-ink">
            {t.fieldProperty}
          </label>
          <input
            id="revoke-property"
            inputMode="numeric"
            value={propertyId}
            disabled={pendingFreeze !== null}
            onChange={(event) => setPropertyId(event.target.value)}
            aria-invalid={touched && propertyInvalid ? true : undefined}
            aria-describedby={touched && propertyInvalid ? 'revoke-property-error' : undefined}
            className="mt-2 w-full rounded-lg border border-hairline bg-white px-3.5 py-2.5 font-mono text-sm ui-transition focus:border-authority"
          />
          {touched && propertyInvalid ? (
            <p id="revoke-property-error" role="alert" className="mt-2 text-sm text-red-700">
              {t.propertyInvalid}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="revoke-reason" className="block text-sm font-medium text-ink">
            {t.fieldReason}
          </label>
          <select
            id="revoke-reason"
            value={reasonCode}
            disabled={pendingFreeze !== null}
            onChange={(event) => setReasonCode(Number(event.target.value))}
            className="mt-2 w-full rounded-lg border border-hairline bg-white px-3.5 py-2.5 text-sm ui-transition focus:border-authority"
          >
            {REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {code} — {t[`reason${code}`]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="revoke-detail" className="block text-sm font-medium text-ink">
          {t.fieldDetail}
        </label>
        <textarea
          id="revoke-detail"
          rows={3}
          maxLength={DETAIL_LIMIT}
          value={detail}
          disabled={pendingFreeze !== null}
          onChange={(event) => setDetail(event.target.value)}
          aria-invalid={touched && detailInvalid ? true : undefined}
          aria-describedby={touched && detailInvalid ? 'revoke-detail-error' : 'revoke-detail-hint'}
          className="mt-2 w-full rounded-lg border border-hairline bg-white px-3.5 py-2.5 text-sm ui-transition focus:border-authority"
        />
        {touched && detailInvalid ? (
          <p id="revoke-detail-error" role="alert" className="mt-2 text-sm text-red-700">
            {t.detailRequired}
          </p>
        ) : (
          <p id="revoke-detail-hint" className="mt-2 flex justify-between gap-4 text-sm text-steel">
            <span>{t.detailHint}</span>
            <span className="shrink-0 font-mono text-xs">
              {format(t.detailCount, { count: detail.length })}
            </span>
          </p>
        )}
      </div>

      {failure ? (
        <Notice tone="danger" title={failure.title}>
          {failure.detail}
        </Notice>
      ) : null}
      {queued ? (
        <Notice tone="success" title={format(t.revocationQueued, { id: queued.propertyId })}>
          <span className="font-mono text-xs break-all">
            {format(t.revocationHash, { hash: queued.detailHash })}
          </span>
        </Notice>
      ) : null}

      <button type="submit" className={buttonStyles.primary} disabled={submitting || pendingFreeze !== null}>
        {submitting ? t.submittingRevocation : t.submitRevocation}
      </button>
    </form>
    {pendingFreeze ? (
      <FreezeStep
        mode="freeze"
        calldata={pendingFreeze.freezeCalldata}
        t={freezeT}
        errors={errors}
        label={format(freezeT.freezePlot, { id: pendingFreeze.propertyId })}
        onDone={frozen}
      />
    ) : null}
    {abandonable ? (
      <UnfreezeAction
        propertyId={abandonable}
        t={freezeT}
        errors={errors}
        onDone={() => setAbandonable(null)}
      />
    ) : null}
    </>
  );
}
