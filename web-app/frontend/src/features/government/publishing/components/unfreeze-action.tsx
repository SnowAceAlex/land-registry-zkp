'use client';

// Lift a freeze (D80). Offered only when no procedure is open on the plot —
// lifting an open one reopens the window D79 closes.

import { useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { buttonStyles } from '@/components/ui/button';

import { type Failure, apiFailure } from '../../api/error-message';
import { getFreezeStatus } from '../../api/freezes';
import type { FreezeStatus } from '../../api/types';
import { FreezeStep } from './freeze-step';

export function UnfreezeAction({
  propertyId,
  t,
  errors,
  onDone,
  label,
  disabled,
}: {
  propertyId: string;
  t: Dictionary['govFreeze'];
  errors: Dictionary['govErrors'];
  onDone?: () => void | Promise<void>;
  /** Button text; defaults to `t.unfreezeCheck`. */
  label?: string;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<FreezeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState(false);

  async function check() {
    setChecking(true);
    setFailure(null);
    try {
      setStatus(await getFreezeStatus(propertyId));
    } catch (error) {
      setFailure(apiFailure(error, errors));
    } finally {
      setChecking(false);
    }
  }

  if (done) return <p className="text-xs text-emerald-700">{t.unfrozenDone}</p>;

  if (status?.unfreezeAllowed) {
    return (
      <FreezeStep
        mode="unfreeze"
        calldata={{ propertyIds: [propertyId], ownerCommitments: [status.ownerCommitment] }}
        t={t}
        errors={errors}
        // F1: re-check right before sending — an open procedure may have appeared meanwhile.
        beforeSign={async () => {
          const fresh = await getFreezeStatus(propertyId);
          setStatus(fresh);
          return fresh.unfreezeAllowed;
        }}
        onDone={async () => {
          setDone(true);
          await onDone?.();
        }}
      />
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={buttonStyles.secondary}
        disabled={checking || disabled}
        onClick={() => void check()}
      >
        {checking ? t.checking : (label ?? t.unfreezeCheck)}
      </button>
      {status && !status.unfreezeAllowed ? (
        <p className="text-xs text-steel">
          {status.openProcedure ? t.unfreezeBlockedOpen : t.unfreezeNotNeeded}
        </p>
      ) : null}
      {failure ? <p className="text-xs text-red-700">{failure.title}</p> : null}
    </div>
  );
}
