/**
 * features/government/transfers/lib/transfer-witness.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Assemble the transfer.circom witness at the counter — the browser twin of
 * transferSmoke.ts step 3.
 *
 * Both Merkle paths come from POST /transfers/preview, never from the seller's
 * receipt: a receipt issued before someone else's publish carries a stale path,
 * and a proof over it fails with RootMismatch. The witness itself is built by
 * shared/circuitInputs.buildTransferInput (D25) — no signal name appears here.
 */

import { type LURRecord, type ProofInput, buildTransferInput } from '@land-registry/blockchain/shared';

import type { TransferPreview } from '../../api/types';

export interface CounterTransferParams {
  /** Rebuilt from the seller's receipt (seller-check.ts). */
  sellerRecord: LURRecord;
  sellerLeaf: bigint;
  sellerSecret: bigint;
  /** Both paths, and the buyer's secret the registry issued with them (D77). */
  preview: TransferPreview;
  currentTimestamp: bigint;
  minRequiredRemainingTerm: bigint;
}

export function buildCounterTransferInput(params: CounterTransferParams): ProofInput {
  const { sellerRecord, preview } = params;
  if (BigInt(preview.propertyId) !== sellerRecord.propertyId) {
    throw new Error(
      `The preview is for plot ${preview.propertyId}, not plot ${sellerRecord.propertyId}`,
    );
  }

  return buildTransferInput({
    oldRecord: sellerRecord,
    // Only the owner changes — anything else is unprovable by construction.
    // The buyer's secret and commitment are the ones the registry issued in
    // the preview (D77).
    newRecord: { ...sellerRecord, ownerCommitment: BigInt(preview.newOwnerCommitment) },
    oldOwnerSecret: params.sellerSecret,
    newOwnerSecret: BigInt(preview.newOwnerSecret),
    oldProof: {
      leaf: params.sellerLeaf,
      siblings: preview.oldSiblings.map((sibling) => BigInt(sibling)),
      pathIndices: preview.oldPathIndices,
      root: BigInt(preview.oldMerkleRoot),
    },
    newProof: {
      leaf: 0n, // the builder reads only siblings, pathIndices and root
      siblings: preview.newSiblings.map((sibling) => BigInt(sibling)),
      pathIndices: preview.newPathIndices,
      root: BigInt(preview.newMerkleRoot),
    },
    currentTimestamp: params.currentTimestamp,
    minRequiredRemainingTerm: params.minRequiredRemainingTerm,
  });
}
