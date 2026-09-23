/**
 * features/resident/proof/lib/proof-feasibility.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Which proofs this record can actually satisfy — the circuits' own predicates,
 * evaluated in TypeScript so the owner is told a sentence instead of watching a
 * spinner for eight seconds and receiving `Assert Failed. Error in template
 * Mortgage_231 line: 79`.
 *
 * ⚠️ THIS IS A MIRROR FOR THE INTERFACE, NEVER A SECURITY CONTROL (D68). The
 *    circuit remains the only thing that decides whether a proof exists; a
 *    blocker found here saves time, and a blocker MISSED here costs nothing but
 *    a slower failure, which `proverFailure()` then words for a human. Nothing
 *    downstream may treat an empty blocker list as permission.
 *
 * Everything runs on the record already in hand. No network call, no secret —
 * these are the owner's own certificate fields, read in the owner's own
 * browser, which is why they can be named on screen at all. The same facts on a
 * public route would defeat `mortgage.circom` outright (D50).
 *
 * The predicates, one per circuit constraint:
 *
 *   ownership.circom  §4  RemainingTermCheck(minRequiredRemainingTerm = 1)
 *                         → validityPeriod > currentTimestamp
 *   mortgage.circom   §4  encumbranceStatus === FREE (D7)
 *                     §5  RemainingTermCheck(minRequiredRemainingTerm = chosen)
 *                         → validityPeriod >= currentTimestamp + chosen
 *
 * ⚠️ PERPETUAL BYPASSES BOTH. D5 stores `validityPeriod = 0n` as the sentinel
 *    for a perpetual title, so a naive comparison concludes the exact opposite
 *    of the truth — that every ONT/ODT plot expired in 1970. `termCheck.circom`
 *    had to dodge the same sentinel (D23, which is why it muxes a deadline
 *    rather than subtracting); the TypeScript mirror has to dodge it again.
 */

import {
  EncumbranceStatus,
  type LURRecord,
  TenureType,
} from '@land-registry/blockchain/shared/types';

import { SECONDS_PER_YEAR } from '@/lib/term';

import type { OwnerProofType } from './owner-witness';

export type ProofBlocker =
  /** The legal term ran out, so no circuit's term check can pass. */
  | 'expired'
  /** A mortgage or dispute is recorded, and mortgage.circom forbids it. */
  | 'encumbered'
  /** More years were asked for than the title has left. */
  | 'term-too-long';

/**
 * Whether the title's term has run out.
 *
 * Blocks EVERY proof, not just one kind, which is why the screen treats it as a
 * stage rather than a note under one option: `ownership.circom` carries the
 * same term check as `mortgage.circom`, just with the threshold pinned to one
 * second. That is also the only reason this is worth computing before the
 * Merkle proof is refreshed — there is nothing the registry could answer that
 * would make an expired title provable.
 */
export function isTitleExpired(record: LURRecord, now: bigint): boolean {
  if (record.tenureType === TenureType.PERPETUAL) return false;
  // `<=`, not `<`: ownership.circom passes minRequiredRemainingTerm = 1, so a
  // title expiring on this very second cannot satisfy it either.
  return record.validityPeriod <= now;
}

/**
 * Every reason the chosen proof cannot be generated from this record.
 *
 * A list rather than the first hit: an encumbered title whose term is also too
 * short should say both, or the owner fixes one number and meets the next wall.
 *
 * `minRemainingTermYears` is null when the owner has not typed a usable number
 * yet — the field's own validation covers that case, and guessing a threshold
 * here would invent a blocker nobody asked about.
 */
export function proofBlockers(
  type: OwnerProofType,
  record: LURRecord,
  now: bigint,
  minRemainingTermYears: number | null,
): ProofBlocker[] {
  const blockers: ProofBlocker[] = [];

  if (isTitleExpired(record, now)) blockers.push('expired');
  if (type === 'ownership') return blockers;

  if (record.encumbranceStatus !== EncumbranceStatus.FREE) blockers.push('encumbered');

  if (
    minRemainingTermYears !== null &&
    record.tenureType !== TenureType.PERPETUAL &&
    record.validityPeriod < now + BigInt(minRemainingTermYears) * SECONDS_PER_YEAR
  ) {
    blockers.push('term-too-long');
  }

  return blockers;
}
