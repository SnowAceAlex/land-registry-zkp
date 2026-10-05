// Only the snarkjs-bound calls are faked (they need gitignored artifacts);
// Poseidon, the tree and the leaf hash stay real — as in proof.service.spec.ts.
jest.mock('@land-registry/blockchain/shared', () => ({
  ...jest.requireActual('@land-registry/blockchain/shared'),
  verifyGroth16Proof: jest.fn().mockResolvedValue(true),
  assertProofFresh: jest.fn(),
}));

import { BadRequestException, ConflictException, GoneException } from '@nestjs/common';
import { Property } from '@prisma/client';
import {
  BN254_FIELD_MODULUS,
  TREE_DEPTH,
  applyLeafUpdates,
  buildTree,
  hashRecord,
  overlayReader,
  poseidonHash,
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

    const service = new TransfersService(prisma, {} as never, {} as never, {} as never);

    await expect(service.preview({ propertyId: '1001' })).rejects.toMatchObject({ status: 410 });
    await expect(service.preview({ propertyId: '1001' })).rejects.toBeInstanceOf(GoneException);
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
    // Deterministic stand-in for IssuanceService: the secret is fixed, the
    // commitment is the real Poseidon hash of it.
    const issuance = {
      generateOwnerSecret: () => 43n,
      commitmentFor: (secret: bigint) => poseidonHash([secret]),
    } as never;

    return {
      service: new TransfersService(prisma, nodes as never, chain, issuance),
      tree,
    };
  }

  it('issues the buyer secret and projects the root a rebuild with that owner would produce', async () => {
    const registry = ['1', '2', '10'].map((propertyId) => makeProperty({ propertyId }));
    const { service, tree } = await harness(registry, registry[0]);

    const result = await service.preview({ propertyId: '1' });

    // D77 — the registry issues the buyer's secret, like an issuance round's.
    expect(result.newOwnerSecret).toBe('43');
    expect(result.newOwnerCommitment).toBe((await poseidonHash([43n])).toString());
    const newOwnerCommitment = result.newOwnerCommitment;

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

    const result = await service.preview({ propertyId: '10' });

    expect(result.oldSiblings).toHaveLength(TREE_DEPTH);
    expect(result.newSiblings).toHaveLength(TREE_DEPTH);
    // D41 makes this automatic rather than a constraint: one plot occupies one
    // slot, so the old and new leaves sit at the same index and walk the same
    // left/right decisions. transfer.circom relies on it.
    expect(result.newPathIndices).toEqual(result.oldPathIndices);
  });
});

describe('TransfersService — the buyer secret at submit and reject (D77)', () => {
  const property = makeProperty({ propertyId: '1001', ownerCommitment: '111' });

  async function scenario(opts: { pendingRevocation?: { id: number } | null } = {}) {
    const secret = 43n;
    const commitment = (await poseidonHash([secret])).toString();
    const signals = ['5', '6', '1001', '111', commitment, '1800000000', '0'];
    const create = jest.fn(async ({ data }) => ({
      id: 1,
      ...data,
      status: 'PENDING',
      rejectReason: null,
      txHash: null,
      changeSetId: null,
      createdAt: new Date(),
      decidedAt: null,
    }));
    const update = jest.fn(async ({ data }) => ({
      id: 1,
      propertyId: '1001',
      newOwnerCommitment: commitment,
      newOwnerSecret: null,
      oldRoot: '5',
      newRoot: '6',
      proof: {},
      publicSignals: [],
      rejectReason: null,
      txHash: null,
      changeSetId: null,
      createdAt: new Date(),
      ...data,
    }));
    const prisma = {
      property: { findUnique: jest.fn().mockResolvedValue(property) },
      transferRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          status: 'PENDING',
          propertyId: '1001',
          proof: {},
          publicSignals: signals,
        }),
        create,
        update,
      },
      revocation: { findFirst: jest.fn().mockResolvedValue(opts.pendingRevocation ?? null) },
    };
    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(5n),
      verifyTransferOnChain: jest.fn().mockResolvedValue(true),
    };
    const issuance = { commitmentFor: (value: bigint) => poseidonHash([value]) };
    const service = new TransfersService(
      prisma as never,
      {} as never,
      chain as never,
      issuance as never,
    );
    const dto = (newOwnerSecret: string) => ({
      propertyId: '1001',
      newOwnerCommitment: commitment,
      newOwnerSecret,
      proof: {},
      publicSignals: signals,
    });
    return { service, create, update, dto, secret };
  }

  it('refuses a secret that does not open the commitment', async () => {
    const { service, create, dto } = await scenario();
    await expect(service.submit(dto('44'))).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a secret outside (0, p)', async () => {
    const { service, create, dto } = await scenario();
    await expect(service.submit(dto('0'))).rejects.toBeInstanceOf(BadRequestException);
    // p reduces to 0 inside Poseidon — the residue, not the number, would open
    // the commitment, and the owner's later proofs would use the wrong value.
    await expect(service.submit(dto(BN254_FIELD_MODULUS.toString()))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('stores the secret in the insert that creates the request, and never returns it', async () => {
    const { service, create, dto, secret } = await scenario();

    const created = await service.submit(dto(secret.toString()));

    expect(create.mock.calls[0][0].data.newOwnerSecret).toBe('43');
    expect(created).not.toHaveProperty('newOwnerSecret');
  });

  it('forgets the secret when the request is rejected', async () => {
    const { service, update } = await scenario();

    await service.reject(1, 'no');

    expect(update.mock.calls[0][0].data.newOwnerSecret).toBeNull();
  });

  it('refuses a plot with a pending revocation — one open procedure per plot', async () => {
    const { service, create, dto, secret } = await scenario({ pendingRevocation: { id: 9 } });

    await expect(service.submit(dto(secret.toString()))).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
});
