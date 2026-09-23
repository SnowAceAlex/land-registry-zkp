import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';

import { makeProperty } from '../../test/factories';
import { TransferBundleService } from './transfer-bundle.service';

const DECIDED_AT = new Date('2026-09-14T03:00:00.000Z');

describe('TransferBundleService (D51)', () => {
  function build(
    over: {
      transfer?: Record<string, unknown> | null;
      property?: ReturnType<typeof makeProperty> | null;
      treeRoot?: bigint;
      rootRecord?: { txHash: string } | null;
    } = {},
  ) {
    const transfer =
      over.transfer === null
        ? null
        : {
            id: 5,
            propertyId: '1001',
            newOwnerCommitment: '777',
            status: 'PUBLISHED',
            decidedAt: DECIDED_AT,
            ...over.transfer,
          };
    const property =
      over.property === undefined
        ? makeProperty({ propertyId: '1001', ownerCommitment: '777' })
        : over.property;
    const merkleProof = { leaf: 5n, siblings: [], pathIndices: [], root: 555n };

    const prisma = {
      transferRequest: { findUnique: jest.fn().mockResolvedValue(transfer) },
      property: { findUnique: jest.fn().mockResolvedValue(property) },
      merkleRoot: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            over.rootRecord === undefined ? { txHash: '0xfeed' } : over.rootRecord,
          ),
      },
    };
    // One row for the stored root, one lookup for the proof (D72) — no tree is
    // built here any more.
    const nodes = {
      rootNow: jest.fn().mockResolvedValue(over.treeRoot ?? 555n),
      proofFor: jest.fn().mockResolvedValue(merkleProof),
    };
    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(555n),
      getRootVersion: jest.fn().mockResolvedValue(9),
      rootRegistryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      explorerTxUrlPrefix: undefined,
    };
    const issuance = {
      buildBuyerBundle: jest.fn().mockResolvedValue({ zip: Buffer.from('PK'), receipt: {} }),
    };
    const service = new TransferBundleService(
      prisma as never,
      nodes as never,
      chain as never,
      issuance as never,
    );
    return { service, prisma, nodes, issuance, property, merkleProof };
  }

  it('builds the buyer bundle against the current root and that root’s own transaction', async () => {
    const { service, prisma, issuance, property, merkleProof } = build();

    const result = await service.build(5);

    expect(issuance.buildBuyerBundle).toHaveBeenCalledWith(
      { property, merkleProof },
      {
        rootVersion: 9,
        merkleRoot: 555n,
        transactionHash: '0xfeed',
        contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        explorerTxUrlPrefix: undefined,
      },
      DECIDED_AT,
    );
    // The txHash of the version being described — not the change set's, which
    // is a different root once anything else has published since.
    expect(prisma.merkleRoot.findUnique).toHaveBeenCalledWith({ where: { version: 9 } });
    expect(result).toEqual({ zip: Buffer.from('PK'), filename: 'transfer-5-property-1001.zip' });
  });

  it('404s on an unknown transfer request', async () => {
    const { service } = build({ transfer: null });
    await expect(service.build(5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['PENDING', 'APPROVED', 'REJECTED'])(
    '409s while the transfer is %s — there is no published root to describe yet',
    async (status) => {
      const { service, nodes } = build({ transfer: { status } });

      await expect(service.build(5)).rejects.toBeInstanceOf(ConflictException);
      // The status check comes first: no point reading the tree for a transfer
      // that has no published root to describe yet.
      expect(nodes.rootNow).not.toHaveBeenCalled();
    },
  );

  it('410s when the certificate has since been revoked', async () => {
    const { service } = build({
      property: makeProperty({ propertyId: '1001', ownerCommitment: '777', status: 'REVOKED' }),
    });
    await expect(service.build(5)).rejects.toBeInstanceOf(GoneException);
  });

  it('409s when the plot has changed hands again, instead of re-issuing a superseded owner', async () => {
    const { service } = build({
      property: makeProperty({ propertyId: '1001', ownerCommitment: 'someone-later' }),
    });
    await expect(service.build(5)).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s when the database tree is not the published one, rather than hand out a proof that fails', async () => {
    const { service, issuance } = build({ treeRoot: 999n });

    await expect(service.build(5)).rejects.toBeInstanceOf(ConflictException);
    expect(issuance.buildBuyerBundle).not.toHaveBeenCalled();
  });

  it('labels the receipt with an empty transactionHash when the root row is missing', async () => {
    const { service, issuance } = build({ rootRecord: null });

    await service.build(5);

    expect(issuance.buildBuyerBundle.mock.calls[0][1].transactionHash).toBe('');
  });
});
