/**
 * features/resident/verify/lib/proof-pipeline.ts — the five checks, in order (D63, D81).
 *
 * A pure function from known facts to the next action, in the shape of
 * `features/government/publishing/next-draft-step.ts`. Pure because the ORDER
 * is the part that is easy to get subtly wrong, and this way it is tested in
 * Node with no browser, no chain and no artifacts.
 *
 * THE ORDER IS THE CONTRACT'S OWN (D33), AND FRESHNESS COMES FIRST (D26):
 *
 *   StaleTimestamp → InvalidProof → RootMismatch → OwnerFrozen → (the same, on chain)
 *
 * Freshness first is not tidiness. `currentTimestamp` is a public input the
 * PROVER chooses, so a proof dated back to when an expired title was still
 * valid is cryptographically perfect — ordering is the only thing that catches
 * a replay. And `RootMismatch` is only reachable after the cryptographic check
 * has passed, so a garbage proof is never reported as merely stale-rooted.
 *
 * OwnerFrozen (D79: owner frozen by a pending procedure) comes after the root check, as on chain.
 * Transfer proofs mark it `skipped` — verifyTransfer is exempt.
 *
 * BLOCKED IS NOT REJECTED. An unreachable chain or a missing verifying key
 * leaves checks `unavailable` and the verdict `unknown`. That is what the
 * screen must say instead of a green tick — and it is why a node that returns
 * a revert without data ends a check `unavailable` rather than `fail`.
 */

import type { ProofRejectionReason } from '@/lib/api-client';

export type CheckName =
  | 'freshness'
  | 'cryptographic'
  | 'rootMatchesChain'
  | 'ownerNotFrozen'
  | 'onChain';

export const CHECK_ORDER: readonly CheckName[] = [
  'freshness',
  'cryptographic',
  'rootMatchesChain',
  'ownerNotFrozen',
  'onChain',
];

export type CheckState = 'pending' | 'running' | 'pass' | 'fail' | 'unavailable' | 'skipped';

/** Which checks cannot run without the chain. */
const NEEDS_CHAIN: readonly CheckName[] = ['rootMatchesChain', 'ownerNotFrozen', 'onChain'];

/** The contract's name for a failure of each check, when none is decoded. */
const REASON_FOR: Record<CheckName, ProofRejectionReason> = {
  freshness: 'StaleTimestamp',
  cryptographic: 'InvalidProof',
  rootMatchesChain: 'RootMismatch',
  ownerNotFrozen: 'OwnerFrozen',
  onChain: 'InvalidProof',
};

export interface PipelineFacts {
  /** A ProofPackage is in hand — lib/proof-file.ts accepted it. */
  parsed: boolean;
  checks: Record<CheckName, CheckState>;
  /** undefined while /public/config or the RPC probe is in flight. */
  chainReachable: boolean | undefined;
  /** The worker reported a missing verification_key.json (D55). */
  artifactsMissing: boolean;
  /** Set by the failing check when it decoded a specific revert. */
  rejection?: ProofRejectionReason;
}

export type PipelineStep =
  | { kind: 'need-proof' }
  | { kind: 'loading' }
  | { kind: 'run'; check: CheckName }
  | { kind: 'blocked'; check: CheckName; why: 'chain-unavailable' | 'artifacts-missing' }
  | { kind: 'rejected'; reason: ProofRejectionReason; at: CheckName }
  | { kind: 'done' };

export function nextVerificationStep(f: PipelineFacts): PipelineStep {
  if (!f.parsed) return { kind: 'need-proof' };

  for (const check of CHECK_ORDER) {
    const state = f.checks[check];

    // Resolved one way or another — move on. `unavailable` is deliberately
    // skipped rather than blocking: the later checks still carry information.
    if (state === 'pass' || state === 'unavailable' || state === 'skipped') continue;

    // Short circuit: nothing after a failure runs, so the verifier is told the
    // FIRST rule that was broken rather than the last.
    if (state === 'fail') {
      return { kind: 'rejected', reason: f.rejection ?? REASON_FOR[check], at: check };
    }

    if (state === 'running') return { kind: 'loading' };

    if (NEEDS_CHAIN.includes(check)) {
      if (f.chainReachable === undefined) return { kind: 'loading' };
      if (!f.chainReachable) return { kind: 'blocked', check, why: 'chain-unavailable' };
    }

    // Only the local cryptographic check needs the verifying key. The contract
    // does not — which is why an unsynced deployment can still obtain the
    // chain's verdict, and a nice demonstration in its own right.
    if (check === 'cryptographic' && f.artifactsMissing) {
      return { kind: 'blocked', check, why: 'artifacts-missing' };
    }

    return { kind: 'run', check };
  }

  return { kind: 'done' };
}

/** A fresh set of facts for a newly parsed proof. */
export function initialChecks(): Record<CheckName, CheckState> {
  return {
    freshness: 'pending',
    cryptographic: 'pending',
    rootMatchesChain: 'pending',
    ownerNotFrozen: 'pending',
    onChain: 'pending',
  };
}
