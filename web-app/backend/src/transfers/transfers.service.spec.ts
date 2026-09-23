import { GoneException } from '@nestjs/common';
import { Property } from '@prisma/client';
import {
  TREE_DEPTH,
  applyLeafUpdates,
  buildTree,
  hashRecord,
  overlayReader,
  proofFrom,
  readerFromTree,
} from '@land-registry/blockchain/shared';

import { TransfersService } from './transfers.service';
import { makeProperty } from '../../test/factories';
import { toLURRecord } from '../records/record.mapper';

describe('TransfersService.requireTransferableProperty (D45/D48)', () => {
  it('410s a revoked property instead of crashing deep inside generateMerkleProof', async () => {
    const revoked = makeProperty({ propertyId: '1001', status: 'REVOKED' });
    const prisma = {
      property: { findUnique: jest.fn().mockResolvedValue(revoked) },
    } as never;

    const service = new TransfersService(prisma, {} as never, {} as never);

    await expect(
      service.preview({ propertyId: '1001', newOwnerCommitment: '123' }),
    ).rejects.toMatchObject({ status: 410 });
    await expect(
      service.preview({ propertyId: '1001', newOwnerCommitment: '123' }),
    ).rejects.toBeInstanceOf(GoneException);
  });
});

describe('TransfersService.preview — both Merkle paths (D28, over the node store)', () => {
  /**
   * `NodeStoreService` is stood in for, but its arithmetic is not: the stub
   * below runs the real `applyLeafUpdates` / `proofFrom` over a real
   * `buildTree`, so what is faked is only the SQL.
   */
  async function harness(registry: Property[], target: Property) {
    const tree = await buildTree(registry.map(toLURRecord));
    const read = readerFromTree(tree);

    const nodes = {
      proofFor: async (property: Property) =>
        proofFrom(Number(property.propertyId), await hashRecord(toLURRecord(property)), read),
      projectRoot: async (updates: Map<number, bigint | null>) => applyLeafUpdates(updates, read),
      proofInOverlay: async (
        property: Property,
        leaf: bigint,
        overlay: Awaited<ReturnType<typeof applyLeafUpdates>>,
      ) => proofFrom(Number(property.propertyId), leaf, overlayReader(overlay, read)),
    };

    const prisma = {
      property: { findUnique: jest.fn().mockResolvedValue(target) },
    } as never;
    const chain = { getRootVersion: jest.fn().mockResolvedValue(4) } as never;

    return { service: new TransfersService(prisma, nodes as never, chain), tree };
  }

  it('projects the root a full rebuild with the new owner would produce', async () => {
    const registry = ['1', '2', '10'].map((propertyId) => makeProperty({ propertyId }));
    const { service, tree } = await harness(registry, registry[0]);

    const newOwnerCommitment = '424242';
    const result = await service.preview({ propertyId: '1', newOwnerCommitment });

    // The invariant the counter depends on (D28 step 2 → D46): the witness must
    // commit to the root the registry WOULD produce. If this drifts, a transfer
    // proof verifies at approval and then fails to match the published root.
    const rebuilt = await buildTree(
      registry
        .map((property) =>
          property.propertyId === '1'
            ? { ...property, ownerCommitment: newOwnerCommitment }
            : property,
        )
        .map(toLURRecord),
    );

    expect(result.oldMerkleRoot).toBe(tree.root.toString());
    expect(result.newMerkleRoot).toBe(rebuilt.root.toString());
    expect(result.oldMerkleRoot).not.toBe(result.newMerkleRoot);
    expect(result.rootVersion).toBe(4);
  });

  it('returns a full-depth path on both sides, and the same path indices', async () => {
    const registry = ['1', '2', '10'].map((propertyId) => makeProperty({ propertyId }));
    const { service } = await harness(registry, registry[2]);

    const result = await service.preview({ propertyId: '10', newOwnerCommitment: '999' });

    expect(result.oldSiblings).toHaveLength(TREE_DEPTH);
    expect(result.newSiblings).toHaveLength(TREE_DEPTH);
    // D41 makes this automatic rather than a constraint: one plot occupies one
    // slot, so the old and new leaves sit at the same index and walk the same
    // left/right decisions. transfer.circom relies on it.
    expect(result.newPathIndices).toEqual(result.oldPathIndices);
  });
});
