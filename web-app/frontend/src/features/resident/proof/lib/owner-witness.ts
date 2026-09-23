/**
 * features/resident/proof/lib/owner-witness.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Assemble the ownership or mortgage witness — the browser twin of
 * `blockchain/scripts/tools/ownerSmoke.ts` steps 3–5.
 *
 * ⚠️ NO CIRCUIT SIGNAL NAME APPEARS HERE (D25). `shared/circuitInputs.ts` owns
 *    them and is the only place in TypeScript that spells them; this module
 *    picks which builder to call and converts the owner's units.
 *
 * ⚠️ THE PATH COMES FROM THE REFRESHED PROOF, NEVER FROM THE RECEIPT. The same
 *    rule the transfer counter follows: a receipt issued before anyone else's
 *    publish carries a path that no longer reaches the current root, and a
 *    proof over it fails with RootMismatch at every verifier.
 *
 * Only two circuits are offered. A transfer witness needs BOTH parties'
 * secrets and the guarded preview (D47), so it belongs at the counter and
 * cannot be built here.
 */

// Subpath imports, not the barrel: the barrel re-exports merkleTree.ts, whose
// circomlibjs import would pull ~3 MB of cryptography in. circuitInputs.ts
// itself needs none — it only names signals and reads TREE_DEPTH.
import {
  buildMortgageInput,
  buildOwnershipInput,
} from '@land-registry/blockchain/shared/circuitInputs';
import type {
  LURRecord,
  MerkleProofData,
  ProofInput,
} from '@land-registry/blockchain/shared/types';

import { yearsToSeconds } from '@/lib/term';

import type { MerkleProofResponse } from '../api';

export type OwnerProofType = 'ownership' | 'mortgage';

export interface OwnerWitnessParams {
  /** Rebuilt from the receipt by bundle-integrity.ts — never re-derived here. */
  record: LURRecord;
  ownerSecret: bigint;
  /** GET /api/proof/:propertyId, not the receipt's own path. */
  refreshed: MerkleProofResponse;
  currentTimestamp: bigint;
  /**
   * Whole years of remaining term the owner chooses to prove (D16).
   * Required for 'mortgage', ignored for 'ownership'.
   */
  minRemainingTermYears?: number;
}

/** Turn the refreshed API response into the shape the builders take. */
function merkleProofData(refreshed: MerkleProofResponse): MerkleProofData {
  return {
    leaf: BigInt(refreshed.leaf),
    siblings: refreshed.siblings.map((sibling) => BigInt(sibling)),
    pathIndices: refreshed.pathIndices,
    root: BigInt(refreshed.merkleRoot),
  };
}

export function buildOwnerProofInput(
  type: OwnerProofType,
  params: OwnerWitnessParams,
): ProofInput {
  const { record, ownerSecret, refreshed, currentTimestamp, minRemainingTermYears } = params;

  // A path for a different plot would produce a witness that cannot satisfy the
  // circuit — a confusing "Assert Failed" seconds later instead of a sentence
  // now. Same guard buildCounterTransferInput makes.
  if (refreshed.propertyId !== record.propertyId.toString()) {
    throw new Error(
      `The refreshed Merkle proof is for property ${refreshed.propertyId}, but the bundle is ` +
        `for ${record.propertyId}`,
    );
  }

  const proof = merkleProofData(refreshed);

  if (type === 'ownership') {
    return buildOwnershipInput({ record, ownerSecret, proof, currentTimestamp });
  }

  if (minRemainingTermYears === undefined) {
    throw new Error('A mortgage proof needs a minimum remaining term, in whole years (D16)');
  }

  return buildMortgageInput({
    record,
    ownerSecret,
    proof,
    currentTimestamp,
    minRequiredRemainingTerm: yearsToSeconds(minRemainingTermYears),
  });
}

/** Filename for the downloaded proof, e.g. `proof-mortgage-1001.json`. */
export function proofFileName(type: OwnerProofType, propertyId: string): string {
  return `proof-${type}-${propertyId}.json`;
}
