'use client';

/**
 * features/government/publishing/components/draft-panel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The sign → mine → confirm workflow of D43, shared by UC-1 (issuance) and
 * UC-4 (change sets). The screen supplies what the draft contains and how to
 * confirm or discard it; this panel owns everything about the chain.
 *
 * The ordering is load-bearing:
 *   1. the wallet signs the draft's root (publishRoot, or
 *      publishRootWithRevocations when a change set revokes — registry.ts);
 *   2. wait for the block;
 *   3. confirm() — the backend re-reads latestRoot itself; the txHash sent
 *      along is a label only.
 *
 * Resuming (D53): the step comes from nextDraftStep(), which compares the
 * draft's root with the chain's. A tab closed after step 1 or 2 reopens on
 * "Confirm", with the transaction hash recalled from sessionStorage.
 */

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { LoaderCircle } from 'lucide-react';
import { useSwitchChain } from 'wagmi';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { type Failure, apiFailure, walletFailure } from '../../api/error-message';
import { useRegistryStatus } from '../../api/hooks';
import type { DraftConfirmation, OpenDraft } from '../../api/types';
import { walletErrorCode } from '../../wallet/registry';
import { usePublishDraft, useRegistryChain } from '../../wallet/use-registry';
import { forgetDraftTx, recallDraftTx, rememberDraftTx } from '../draft-tx-store';
import { nextDraftStep } from '../next-draft-step';

type Phase = 'idle' | 'signing' | 'mining' | 'confirming' | 'discarding';

export type DraftOutcome =
  | { kind: 'confirmed'; confirmation: DraftConfirmation }
  | { kind: 'discarded' };

/** sessionStorage behind a getter: merely touching it throws in some private modes. */
const session = {
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};

export function DraftPanel({
  draft,
  t,
  errors,
  summary,
  warnings,
  onConfirm,
  onDiscard,
  onSettled,
}: {
  draft: OpenDraft;
  t: Dictionary['govDraft'];
  errors: Dictionary['govErrors'];
  /** What the draft contains, rendered by the screen that created it. */
  summary: React.ReactNode;
  /** Shown above the signing step — consequences the officer should weigh first. */
  warnings?: React.ReactNode;
  onConfirm: (id: number, txHash: string | undefined) => Promise<DraftConfirmation>;
  onDiscard: (id: number) => Promise<unknown>;
  onSettled: (outcome: DraftOutcome) => void;
}) {
  const status = useRegistryStatus();
  const target = status.data
    ? { address: status.data.contractAddress, chainId: status.data.chainId }
    : undefined;
  const chain = useRegistryChain(target);
  const { send, waitMined } = usePublishDraft();
  const { switchChain, isPending: switching } = useSwitchChain();

  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [txHash, setTxHash] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : recallDraftTx(session, draft.kind, draft.id),
  );

  const step = nextDraftStep({
    currentKind: draft.kind,
    openDraft: draft,
    onChainLatestRoot: chain.latestRoot,
    walletConnected: chain.isConnected,
    walletChainId: chain.walletChainId,
    expectedChainId: target?.chainId,
    hasRole: chain.hasRole,
  });

  async function confirm(hash: string | undefined) {
    setPhase('confirming');
    setFailure(null);
    try {
      const confirmation = await onConfirm(draft.id, hash);
      forgetDraftTx(session, draft.kind, draft.id);
      onSettled({ kind: 'confirmed', confirmation });
    } catch (error) {
      setFailure(apiFailure(error, errors));
      await chain.refetch();
    } finally {
      setPhase('idle');
    }
  }

  async function sign() {
    if (!target) return;
    setFailure(null);
    setPhase('signing');

    let hash: `0x${string}`;
    try {
      hash = await send(target, draft);
    } catch (error) {
      // DuplicateRoot means this root is already latest: a previous signature
      // landed. Re-reading the chain turns the step into "confirm".
      if (walletErrorCode(error) === 'duplicate-root') await chain.refetch();
      setFailure(walletFailure(error, errors));
      setPhase('idle');
      return;
    }

    rememberDraftTx(session, draft.kind, draft.id, hash);
    setTxHash(hash);
    setPhase('mining');
    try {
      await waitMined(target, hash);
    } catch (error) {
      setFailure(walletFailure(error, errors));
      setPhase('idle');
      return;
    }

    await chain.refetch();
    await confirm(hash);
  }

  async function discard() {
    if (!window.confirm(t.discardConfirm)) return;
    setPhase('discarding');
    setFailure(null);
    try {
      await onDiscard(draft.id);
      forgetDraftTx(session, draft.kind, draft.id);
      onSettled({ kind: 'discarded' });
    } catch (error) {
      setFailure(apiFailure(error, errors));
    } finally {
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';
  const title = format(draft.kind === 'issuance' ? t.titleIssuance : t.titleChangeset, {
    id: draft.id,
  });

  return (
    <section
      aria-labelledby={`draft-${draft.kind}-${draft.id}`}
      className="rounded-xl border border-hairline bg-white p-5 whisper-shadow sm:p-6"
    >
      <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id={`draft-${draft.kind}-${draft.id}`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-xs text-steel">
          {format(t.created, { time: new Date(draft.createdAt).toLocaleString() })}
        </p>
      </header>

      <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-whisper pt-4 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-steel">{t.rootToSign}</dt>
        <dd className="min-w-0">
          <HashText value={draft.newRoot} head={14} tail={10} />
        </dd>
        {txHash ? (
          <>
            <dt className="text-steel">{t.transaction}</dt>
            <dd className="min-w-0">
              <HashText value={txHash} head={10} tail={8} />
            </dd>
          </>
        ) : null}
      </dl>

      <div className="mt-4 border-t border-whisper pt-4">{summary}</div>

      <div className="mt-4 space-y-3">
        {step === 'sign' || step === 'connect' || step === 'wrongChain' || step === 'noRole'
          ? warnings
          : null}

        {chain.latestRootError ? (
          <Notice tone="danger" title={t.chainUnavailable}>
            {chain.latestRootError.message}
          </Notice>
        ) : null}

        {failure ? (
          <Notice tone="danger" title={failure.title}>
            {failure.detail}
          </Notice>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-4 border-t border-whisper pt-5">
        {busy ? (
          <p className="flex items-center gap-2 text-sm text-ink" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            {t[phase as Exclude<Phase, 'idle'>]}
          </p>
        ) : step === 'loading' ? (
          <div className="space-y-2" aria-label={t.loading}>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-9 w-48" />
          </div>
        ) : step === 'confirm' ? (
          <StepRow text={t.stepConfirm}>
            <button type="button" className={buttonStyles.primary} onClick={() => confirm(txHash ?? undefined)}>
              {t.confirm}
            </button>
          </StepRow>
        ) : step === 'connect' ? (
          <StepRow text={t.stepConnect}>
            <ConnectButton showBalance={false} />
          </StepRow>
        ) : step === 'wrongChain' ? (
          <StepRow
            text={format(t.stepWrongChain, {
              actual: chain.walletChainId ?? '?',
              expected: target?.chainId ?? '?',
            })}
          >
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={switching || !target}
              onClick={() => target && switchChain({ chainId: target.chainId })}
            >
              {t.switchChain}
            </button>
          </StepRow>
        ) : step === 'noRole' ? (
          <Notice tone="warning" title={format(t.stepNoRole, { account: chain.account ?? '' })} />
        ) : step === 'sign' ? (
          <StepRow text={t.stepSign}>
            <button type="button" className={buttonStyles.primary} onClick={sign}>
              {draft.kind === 'issuance' ? t.signIssuance : t.signChangeset}
            </button>
          </StepRow>
        ) : null}

        {step !== 'confirm' ? (
          <div>
            <button
              type="button"
              className={`${buttonStyles.secondary} hover:border-red-300 hover:text-red-700`}
              disabled={busy}
              onClick={discard}
            >
              {phase === 'discarding' ? t.discarding : t.discard}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StepRow({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-prose text-sm leading-relaxed text-ink">{text}</p>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
