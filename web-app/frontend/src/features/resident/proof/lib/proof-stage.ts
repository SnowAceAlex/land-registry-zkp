/**
 * features/resident/proof/lib/proof-stage.ts - which step UC-5 is on (D64).
 *
 * A pure function from known facts to the next stage, in the shape of
 * `features/government/publishing/next-draft-step.ts`. Keeping it pure is what
 * makes the ordering testable in Node, with no browser, no chain and no
 * artifacts — and the ordering is the part that is easy to get subtly wrong.
 *
 * D64 — "STALE" HAS TWO MEANINGS AND THEY MUST NOT SHARE A STAGE:
 *
 *  - BENIGN: the Merkle path inside the owner's receipt.json predates the
 *    current root. This is the normal state as soon as ANYONE else transfers a
 *    plot, because one leaf moving alters every node on its path and every
 *    other leaf has a sibling there. `ownerSmoke.ts` records it as a note, not
 *    a failure. It is not a stage at all: `isBundleStale()` drives an info
 *    banner and proving continues from the refreshed path.
 *
 *  - BLOCKING: the tree the registry currently implies is not the published
 *    root (`inSync === false`). Proving would produce a proof that EVERY
 *    verifier rejects with RootMismatch, so the stage is `root-not-published`
 *    and the button is disabled. The cause is on the registry's side — a draft
 *    signed but not confirmed, or a chain restarted against a live database —
 *    so the copy must not blame the owner's file.
 */

import type { BundleErrorCode } from '@/lib/bundle';

import type { IntegrityIssue } from './bundle-integrity';

export type ProofStage =
  | 'no-bundle'
  | 'parsing'
  | 'bundle-rejected'
  | 'integrity-failed'
  | 'refreshing'
  | 'chain-unavailable'
  | 'root-not-published'
  | 'ready'
  | 'proving'
  | 'done';

export interface ProofStageFacts {
  bundleLoaded: boolean;
  /** Set when lib/bundle.ts refused the files. */
  bundleError: BundleErrorCode | null;
  /** null until checkBundleIntegrity has answered. */
  integrityIssues: IntegrityIssue[] | null;
  /** Decimal root from GET /api/proof/:id; null until it answers. */
  refreshedRoot: string | null;
  /** The backend's own view of whether its tree matches the chain (D40). */
  refreshedInSync: boolean;
  /** latestRoot read directly from the chain; undefined while in flight. */
  chainRoot: string | undefined;
  /** undefined while /public/config or the RPC probe is in flight. */
  chainReachable: boolean | undefined;
  busy: 'parsing' | 'refreshing' | 'proving' | null;
  hasResult: boolean;
}

export function nextProofStage(f: ProofStageFacts): ProofStage {
  if (f.busy === 'parsing') return 'parsing';
  // A rejected file outranks "no file": the owner picked something, and being
  // told nothing happened would be wrong.
  if (f.bundleError) return 'bundle-rejected';
  if (!f.bundleLoaded) return 'no-bundle';

  if (f.integrityIssues === null) return 'parsing';
  if (f.integrityIssues.length > 0) return 'integrity-failed';

  if (f.busy === 'refreshing' || f.refreshedRoot === null) return 'refreshing';
  if (f.chainReachable === undefined) return 'refreshing';

  // Blocking rather than a warning: comparing against latestRoot first is the
  // only cheap way to save an owner from generating a doomed proof. The screen
  // offers a retry and deliberately offers no override.
  if (!f.chainReachable) return 'chain-unavailable';
  if (!f.refreshedInSync || f.refreshedRoot !== f.chainRoot) return 'root-not-published';

  if (f.busy === 'proving') return 'proving';
  if (f.hasResult) return 'done';
  return 'ready';
}

/**
 * Whether the receipt's own path is older than the one just refreshed.
 *
 * The BENIGN case. Worth telling the owner — their file looks different from
 * what the screen is using — but it is expected, it is already repaired, and
 * it must never read as an error.
 */
export function isBundleStale(receiptRoot: string, refreshedRoot: string | null): boolean {
  return refreshedRoot !== null && receiptRoot !== refreshedRoot;
}
