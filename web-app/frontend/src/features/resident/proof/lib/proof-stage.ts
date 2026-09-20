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
 *
 * D68 — TWO MORE WALLS, BOTH OF THEM DEAD ENDS RATHER THAN DELAYS:
 *
 *  - `title-expired`: the term ran out, so every circuit's term check fails.
 *    Placed BEFORE `refreshing` because no answer from the registry could
 *    change it — the round trip would only slow down the bad news.
 *
 *  - `superseded`: the registry's current leaf for this plot is not this
 *    bundle's leaf, so the plot was transferred or otherwise amended after this
 *    receipt was issued. The refreshed Merkle path belongs to the NEW leaf,
 *    which is precisely what `merkle.root === merkleRoot` rejects at
 *    ownership.circom line 76. Placed AFTER `root-not-published`: when the
 *    registry is ahead of the chain that leaf comes from an unpublished tree,
 *    and accusing an owner on the strength of a change the blockchain has not
 *    recorded would be the wrong order of proof.
 *
 * Both are terminal for the loaded bundle, and the screen shows nothing but the
 * reason — no record card, no check list. There is no fix on this page, so the
 * only useful next action is loading a different bundle.
 *
 * A third joins them: `no-proof-possible`, for when the REGISTRY is the one
 * saying no. `GET /api/proof/:id` answers 410 for a revoked plot and 400 for
 * one never issued (D39), and neither is a network problem a retry could fix —
 * the leaf is not in the tree, so no Merkle proof exists to fetch.
 *
 * ⚠️ ORDERING BUG THIS FIXES. `refreshedRoot === null` used to be tested before
 *    `chainReachable`, so ANY failed refresh — revoked, unissued, 503, node
 *    down — left the machine at `refreshing` for good: a spinner that never
 *    stopped, under a record card the owner had just been told was unusable.
 *    A failed attempt is not a pending one, and the test for "we tried and it
 *    did not work" has to come first.
 */

import type { BundleErrorCode } from '@/lib/bundle';

import type { IntegrityIssue } from './bundle-integrity';

export type ProofStage =
  | 'no-bundle'
  | 'parsing'
  | 'bundle-rejected'
  | 'integrity-failed'
  | 'title-expired'
  | 'refreshing'
  | 'no-proof-possible'
  | 'chain-unavailable'
  | 'root-not-published'
  | 'superseded'
  | 'ready'
  | 'proving'
  | 'done';

export interface ProofStageFacts {
  bundleLoaded: boolean;
  /** Set when lib/bundle.ts refused the files. */
  bundleError: BundleErrorCode | null;
  /** null until checkBundleIntegrity has answered. */
  integrityIssues: IntegrityIssue[] | null;
  /**
   * `isTitleExpired()` over the bundle's own record (D68). Only consulted once
   * `integrityIssues` has answered, since both come from the same parse.
   */
  titleExpired: boolean;
  /** Decimal leaf recomputed from the bundle; null until the parse answers. */
  bundleLeaf: string | null;
  /**
   * The leaf `GET /api/proof/:id` currently records for this plot; null until
   * it answers. Compared as decimal strings — both sides produce them from the
   * same Poseidon output, so there is no formatting to reconcile.
   */
  registryLeaf: string | null;
  /**
   * The registry answered definitively that no proof can exist for this plot:
   * revoked (410) or never issued (400). Distinct from `chainReachable: false`
   * because a retry is pointless — the leaf is not in the tree.
   */
  refreshRejected: boolean;
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

  // Before the network on purpose: an expired title is unprovable whatever the
  // registry answers, so the round trip would buy nothing but a slower no.
  if (f.titleExpired) return 'title-expired';

  if (f.busy === 'refreshing') return 'refreshing';

  // Both failure tests come BEFORE the "still waiting" ones. An attempt that
  // came back empty leaves `refreshedRoot` null exactly like an attempt still
  // in flight, and reading that as "in flight" is what spun the old spinner
  // forever.
  if (f.refreshRejected) return 'no-proof-possible';
  // Blocking rather than a warning: comparing against latestRoot first is the
  // only cheap way to save an owner from generating a doomed proof. The screen
  // offers a retry and deliberately offers no override.
  if (f.chainReachable === false) return 'chain-unavailable';

  if (f.refreshedRoot === null || f.chainReachable === undefined) return 'refreshing';
  if (!f.refreshedInSync || f.refreshedRoot !== f.chainRoot) return 'root-not-published';

  // Only meaningful once the two roots agree above: the leaf is read from the
  // registry's tree, and a tree the chain has not accepted cannot be used to
  // tell an owner their certificate was superseded.
  if (f.bundleLeaf !== null && f.registryLeaf !== null && f.bundleLeaf !== f.registryLeaf) {
    return 'superseded';
  }

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
