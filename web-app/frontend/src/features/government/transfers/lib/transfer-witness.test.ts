import { type LURRecord, TREE_DEPTH, buildTransferInput } from '@land-registry/blockchain/shared';
import { describe, expect, it } from 'vitest';

import type { TransferPreview } from '../../api/types';
import { buildCounterTransferInput } from './transfer-witness';

const sellerRecord: LURRecord = {
  propertyId: 1001n,
  ownerCommitment: 111n,
  useType: 0,
  validityPeriod: 0n,
  encumbranceStatus: 0,
  tenureType: 0,
  offchainHash: 999n,
};

const path = (seed: number) => Array.from({ length: TREE_DEPTH }, (_, i) => String(seed + i));
const bits = (seed: number) => Array.from({ length: TREE_DEPTH }, (_, i) => (seed >> i) & 1);

const preview: TransferPreview = {
  propertyId: '1001',
  rootVersion: 3,
  oldMerkleRoot: '5000',
  newMerkleRoot: '6000',
  oldSiblings: path(100),
  oldPathIndices: bits(1001),
  newSiblings: path(200),
  newPathIndices: bits(1001),
};

describe('buildCounterTransferInput (D28 step 3, at the counter)', () => {
  it('proves against the preview paths and moves only the owner commitment', () => {
    const input = buildCounterTransferInput({
      sellerRecord,
      sellerLeaf: 7777n,
      sellerSecret: 42n,
      buyerSecret: 43n,
      buyerCommitment: 222n,
      preview,
      currentTimestamp: 1_800_000_000n,
      minRequiredRemainingTerm: 0n,
    });

    // The expectation goes through the same shared builder (D25), so no circuit
    // signal name is spelled out in this file. What it pins is the WIRING: the
    // old path is the registry's current one from the preview — never the path
    // inside a receipt, which is stale after anyone else's publish.
    expect(input).toEqual(
      buildTransferInput({
        oldRecord: sellerRecord,
        newRecord: { ...sellerRecord, ownerCommitment: 222n },
        oldOwnerSecret: 42n,
        newOwnerSecret: 43n,
        oldProof: {
          leaf: 7777n,
          siblings: preview.oldSiblings.map(BigInt),
          pathIndices: preview.oldPathIndices,
          root: 5000n,
        },
        newProof: {
          leaf: 0n,
          siblings: preview.newSiblings.map(BigInt),
          pathIndices: preview.newPathIndices,
          root: 6000n,
        },
        currentTimestamp: 1_800_000_000n,
        minRequiredRemainingTerm: 0n,
      }),
    );
  });

  it('refuses a preview for a different plot', () => {
    expect(() =>
      buildCounterTransferInput({
        sellerRecord,
        sellerLeaf: 7777n,
        sellerSecret: 42n,
        buyerSecret: 43n,
        buyerCommitment: 222n,
        preview: { ...preview, propertyId: '1002' },
        currentTimestamp: 1_800_000_000n,
        minRequiredRemainingTerm: 0n,
      }),
    ).toThrow(/1002/);
  });
});
