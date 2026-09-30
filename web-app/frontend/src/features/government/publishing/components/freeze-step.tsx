'use client';

// Sign a freeze or unfreeze (D79/D80). No confirm step: the caller that needs
// it (submit/request/approve/createDraft) reads frozenOwner from chain itself.

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { LoaderCircle } from 'lucide-react';
import type { Hex } from 'viem';
import { useSwitchChain } from 'wagmi';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';

import { type Failure, walletFailure } from '../../api/error-message';
import { useRegistryStatus } from '../../api/hooks';
import type { FreezeCalldata } from '../../api/types';
import { freezeCallsFor } from '../../wallet/registry';
import { useFreezeWrites, useRegistryChain } from '../../wallet/use-registry';
import { nextFreezeStep } from '../next-freeze-step';

type Phase = 'idle' | 'signing' | 'mining';

export function FreezeStep({
  mode,
  calldata,
  t,
  errors,
  onDone,
  beforeSign,
  label,
}: {
  mode: 'freeze' | 'unfreeze';
  calldata: FreezeCalldata;
  t: Dictionary['govFreeze'];
  errors: Dictionary['govErrors'];
  /** Runs once every transaction is mined — typically: re-read the freeze status. */
  onDone: () => void | Promise<void>;
  /** F1: re-check right before signing; false aborts with no transaction sent. */
  beforeSign?: () => Promise<boolean>;
  /** F3: which plot this is, shown under the title (omit for a multi-plot batch). */
  label?: string;
}) {
  const status = useRegistryStatus();
  const target = status.data
    ? { address: status.data.contractAddress, chainId: status.data.chainId }
    : undefined;
  const chain = useRegistryChain(target);
  const { send, waitMined } = useFreezeWrites();
  const { switchChain, isPending: switching } = useSwitchChain();

  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);

  const step = nextFreezeStep({
    targetKnown: target !== undefined,
    walletConnected: chain.isConnected,
    walletChainId: chain.walletChainId,
    expectedChainId: target?.chainId,
    hasRole: chain.hasRole,
  });

  async function sign() {
    if (!target) return;
    setFailure(null);
    if (beforeSign && !(await beforeSign())) {
      setFailure({ title: t.unfreezeNoLongerAllowed });
      return;
    }
    // One transaction per MAX_FREEZES_PER_TX plots.
    for (const call of freezeCallsFor(mode, calldata)) {
      setPhase('signing');
      let hash: Hex;
      try {
        hash = await send(target, call);
      } catch (error) {
        setFailure(walletFailure(error, errors));
        setPhase('idle');
        return;
      }
      setPhase('mining');
      try {
        await waitMined(target, hash);
      } catch (error) {
        setFailure(walletFailure(error, errors));
        setPhase('idle');
        return;
      }
    }
    setPhase('idle');
    await onDone();
  }

  const count = calldata.propertyIds.length;

  return (
    <div className="space-y-3 rounded-lg border border-hairline bg-surface p-4">
      <p className="text-sm font-medium text-ink">
        {format(mode === 'freeze' ? t.freezeTitle : t.unfreezeTitle, { count })}
      </p>
      {label ? <p className="text-xs text-steel">{label}</p> : null}
      <p className="max-w-prose text-sm leading-relaxed text-steel">
        {mode === 'freeze' ? t.freezeBody : t.unfreezeBody}
      </p>

      {failure ? <Notice tone="danger" title={failure.title} /> : null}

      {phase !== 'idle' ? (
        <p className="flex items-center gap-2 text-sm text-ink" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          {t[phase]}
        </p>
      ) : step === 'loading' ? (
        <p className="text-sm text-steel">{t.loading}</p>
      ) : step === 'connect' ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-sm text-ink">{t.stepConnect}</p>
          <ConnectButton showBalance={false} />
        </div>
      ) : step === 'wrongChain' ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-sm text-ink">
            {format(t.stepWrongChain, {
              actual: chain.walletChainId ?? '?',
              expected: target?.chainId ?? '?',
            })}
          </p>
          <button
            type="button"
            className={buttonStyles.primary}
            disabled={switching || !target}
            onClick={() => target && switchChain({ chainId: target.chainId })}
          >
            {t.switchChain}
          </button>
        </div>
      ) : step === 'noRole' ? (
        <Notice tone="warning" title={format(t.stepNoRole, { account: chain.account ?? '' })} />
      ) : (
        <button type="button" className={buttonStyles.primary} onClick={() => void sign()}>
          {mode === 'freeze' ? t.signFreeze : t.signUnfreeze}
        </button>
      )}
    </div>
  );
}
