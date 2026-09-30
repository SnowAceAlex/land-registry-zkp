'use client';

/**
 * features/resident/verify/components/check-list.tsx — the five checks (D63, D81).
 *
 * Each row carries a sentence on WHY the check exists, not just its state. A
 * verifier cannot be expected to know that the proof's timestamp is chosen by
 * the prover, and without that fact the freshness check looks like bureaucratic
 * noise rather than the only defence against a replayed proof.
 *
 * The checks show the contract's own names in the copy, untranslated, so what
 * this page says and what `LandRegistryVerifier` reverts with are the same
 * words (D33).
 */

import { Check, CircleSlash, LoaderCircle, Minus, SkipForward, X } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { Notice } from '@/components/ui/notice';

import { CHECK_ORDER, type CheckName, type CheckState, type PipelineStep } from '../lib/proof-pipeline';

type Strings = Dictionary['residentVerify'];

const LABELS = {
  freshness: { label: 'check_freshness', why: 'check_freshnessWhy' },
  cryptographic: { label: 'check_cryptographic', why: 'check_cryptographicWhy' },
  rootMatchesChain: { label: 'check_rootMatchesChain', why: 'check_rootMatchesChainWhy' },
  ownerNotFrozen: { label: 'check_ownerNotFrozen', why: 'check_ownerNotFrozenWhy' },
  onChain: { label: 'check_onChain', why: 'check_onChainWhy' },
} as const satisfies Record<CheckName, { label: keyof Strings; why: keyof Strings }>;

const STATES = {
  pending: { icon: Minus, tone: 'text-steel', key: 'state_pending' },
  running: { icon: LoaderCircle, tone: 'text-steel animate-spin', key: 'state_running' },
  pass: { icon: Check, tone: 'text-emerald-600', key: 'state_pass' },
  fail: { icon: X, tone: 'text-red-600', key: 'state_fail' },
  unavailable: { icon: CircleSlash, tone: 'text-amber-600', key: 'state_unavailable' },
  skipped: { icon: SkipForward, tone: 'text-steel', key: 'state_skipped' },
} as const satisfies Record<CheckState, { icon: unknown; tone: string; key: keyof Strings }>;

export function CheckList({
  checks,
  step,
  t,
}: {
  checks: Record<CheckName, CheckState>;
  step: PipelineStep;
  t: Strings;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.checksTitle}</h2>
      <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.checksBody}</p>

      <ol className="space-y-2">
        {CHECK_ORDER.map((check) => {
          const state = checks[check];
          const { icon: Icon, tone, key } = STATES[state];
          const { label, why } = LABELS[check];

          return (
            <li key={check} className="rounded-lg border border-hairline bg-surface px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} strokeWidth={2} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{t[label]}</p>
                  <p className="mt-1 text-xs leading-relaxed text-steel">{t[why]}</p>
                </div>
                <span className="shrink-0 text-xs text-steel">{t[key]}</span>
              </div>
            </li>
          );
        })}
      </ol>

      {step.kind === 'blocked' ? (
        <Notice tone="warning" title={t[`blocked_${step.why}` as keyof Strings]} />
      ) : null}

      {step.kind === 'rejected' ? (
        <Notice tone="danger" title={t[`rejected_${step.reason}` as keyof Strings]}>
          {t[`rejected_${step.reason}Body` as keyof Strings]}
        </Notice>
      ) : null}
    </section>
  );
}
