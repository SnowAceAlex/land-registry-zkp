import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { IssuanceBatchService } from './issuance-batch.service';
import { makeProperty } from '../../test/factories';

/** The shape `NodeStoreService.projectRoot` returns. */
const overlayOf = (root: bigint) => ({ root, touched: new Map<string, bigint>(), removed: [] });

const draftRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  status: 'DRAFT',
  newRoot: '999',
  draftSecrets: { '1001': '42' },
  properties: [{ propertyId: '1001' }],
  ...over,
});

/**
 * A full Property row: `leafUpdatesFor` hashes it through `toLURRecord`, so a
 * minimal stub would throw before reaching the behaviour under test.
 */
const propertyRow = (over: Record<string, unknown> = {}) =>
  makeProperty({
    propertyId: '1001',
    status: 'IMPORTED',
    ownerCommitment: null,
    certificateSerial: 'CERT-2026-001',
    ...over,
  } as never);

describe('IssuanceBatchService (D43)', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const findUnique = jest.fn().mockResolvedValue(draftRow());
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      issuanceBatch: { findUnique, update, create: jest.fn() },
      property: { update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
      ...over,
    } as never;
    return { prisma, findUnique, update };
  };

  it('lists issuance batches newest-first, without draftSecrets or archiveZip', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 2,
        status: 'PUBLISHED',
        newRoot: '999',
        rootVersion: 7,
        txHash: '0xabc',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        publishedAt: new Date('2026-09-01T00:05:00.000Z'),
        archiveExpiresAt: new Date('2026-09-08T00:05:00.000Z'),
        _count: { properties: 3 },
      },
    ]);
    const prisma = { issuanceBatch: { findMany } } as never;
    const service = new IssuanceBatchService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    const result = await service.list();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
    // draftSecrets/archiveZip are never in the select, so they cannot leak
    // through even if a caller widens the returned type later.
    expect(result).toEqual([
      {
        id: 2,
        status: 'PUBLISHED',
        newRoot: '999',
        rootVersion: 7,
        txHash: '0xabc',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        publishedAt: new Date('2026-09-01T00:05:00.000Z'),
        archiveExpiresAt: new Date('2026-09-08T00:05:00.000Z'),
        propertyCount: 3,
      },
    ]);
  });

  it('refuses to confirm when the chain root does not match the draft', async () => {
    const { prisma } = build();
    const chain = { getLatestRoot: jest.fn().mockResolvedValue(123n), getRootVersion: jest.fn() };
    const service = new IssuanceBatchService(
      prisma,
      {} as never,
      {} as never,
      chain as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(service.confirm(1)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses to confirm a draft that is not in DRAFT status', async () => {
    const { prisma, findUnique } = build();
    findUnique.mockResolvedValue(draftRow({ status: 'PUBLISHED' }));
    const service = new IssuanceBatchService(
      prisma,
      {} as never,
      {} as never,
      { getLatestRoot: jest.fn(), getRootVersion: jest.fn() } as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(service.confirm(1)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s on an unknown draft', async () => {
    const { prisma, findUnique } = build();
    findUnique.mockResolvedValue(null);
    const service = new IssuanceBatchService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(service.confirm(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks the draft lock before creating a new draft', async () => {
    const { prisma } = build();
    const assertNoOpenDraft = jest.fn().mockRejectedValue(new ConflictException('open'));
    const service = new IssuanceBatchService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft } as never,
      {} as never,
      {} as never,
    );

    await expect(service.createDraft(['1001'])).rejects.toBeInstanceOf(ConflictException);
    expect(assertNoOpenDraft).toHaveBeenCalled();
  });

  it('discarding clears the secrets so they cannot linger', async () => {
    const { prisma, update } = build();
    const service = new IssuanceBatchService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await service.discard(1);

    expect(update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'DISCARDED', draftSecrets: null },
    });
  });

  it('createDraft persists the draft and never touches a Property row', async () => {
    const propertyUpdate = jest.fn();
    const createdAt = new Date('2026-09-14T02:00:00.000Z');
    const batchCreate = jest.fn().mockResolvedValue({
      id: 42,
      newRoot: '555',
      status: 'DRAFT',
      draftSecrets: { '1001': '111', '1002': '222' },
      createdAt,
    });
    const prisma = {
      issuanceBatch: { findUnique: jest.fn(), update: jest.fn(), create: batchCreate },
      property: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            propertyRow({ propertyId: '1001' }),
            propertyRow({ propertyId: '1002' }),
          ]),
        update: propertyUpdate,
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    } as never;

    const nodes = {
      projectRoot: jest.fn().mockResolvedValue(overlayOf(555n)),
      applyStatements: jest.fn().mockReturnValue(['APPLY_NODES_STMT']),
    };
    const issuance = {
      generateOwnerSecret: jest.fn().mockReturnValueOnce(111n).mockReturnValueOnce(222n),
      commitmentFor: jest.fn((secret: bigint) => Promise.resolve(secret + 1000n)),
    };

    const service = new IssuanceBatchService(
      prisma,
      nodes as never,
      issuance as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    const result = await service.createDraft(['1001', '1002']);

    // The same shape draftDetail() rebuilds later (D53), so a portal that lost
    // this response can recover the draft from GET /government/drafts/open.
    expect(result).toEqual({
      kind: 'issuance',
      id: 42,
      newRoot: '555',
      createdAt,
      propertyIds: ['1001', '1002'],
    });
    expect(batchCreate).toHaveBeenCalledWith({
      data: {
        status: 'DRAFT',
        newRoot: '555',
        draftSecrets: { '1001': '111', '1002': '222' },
      },
    });
    // The regression guard for the core invariant: a DRAFT must never write a
    // Property row — only confirm() may do that, and only after a signature.
    expect(propertyUpdate).not.toHaveBeenCalled();
  });

  it('confirm applies the batch: issues the properties, publishes, and records issuance events', async () => {
    const propertyUpdate = jest.fn();
    const issuanceBatchUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      issuanceBatch: {
        findUnique: jest.fn().mockResolvedValue(draftRow()),
        update: issuanceBatchUpdate,
        create: jest.fn(),
      },
      property: {
        findMany: jest.fn().mockResolvedValue([propertyRow({ propertyId: '1001' })]),
        update: propertyUpdate,
        updateMany: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as never;

    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(999n),
      getRootVersion: jest.fn().mockResolvedValue(7),
    };
    const nodes = {
      projectRoot: jest.fn().mockResolvedValue(overlayOf(999n)),
      proofInOverlay: jest.fn().mockResolvedValue({ leaf: 123n }),
      applyStatements: jest.fn().mockReturnValue(['APPLY_NODES_STMT']),
    };
    const issuance = {
      commitmentFor: jest.fn().mockResolvedValue(777n),
      batchContext: jest
        .fn()
        .mockReturnValue({ issuer: { ethereumAccount: '0xissuer' }, issuedOn: '2026-09-07' }),
      buildBundleFiles: jest
        .fn()
        .mockResolvedValue({ propertyId: '1001', receipt: {}, files: ['FILE'] }),
    };
    const archiveBuild = jest.fn().mockResolvedValue(Buffer.from('PK-archive'));
    const issuedStatements = jest.fn().mockReturnValue(['EVENT_STMT']);

    const service = new IssuanceBatchService(
      prisma,
      nodes as never,
      issuance as never,
      chain as never,
      {
        recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
      } as never,
      { assertNoOpenDraft: jest.fn() } as never,
      { issuedStatements } as never,
      { build: archiveBuild } as never,
    );

    const result = await service.confirm(1);

    expect(result).toEqual({ id: 1, rootVersion: 7, txHash: undefined, propertyIds: ['1001'] });

    expect(propertyUpdate).toHaveBeenCalledWith({
      where: { propertyId: '1001' },
      data: {
        ownerCommitment: '777',
        status: 'ISSUED',
        // D72 repurposed these two: `leaf` is the plot's new leaf, `rootVersion`
        // the root it first appeared in. Asserting the exact shape is the point
        // — a column added here later must be a decision, not an accident.
        leaf: expect.any(String),
        rootVersion: 7,
        issuedAt: expect.any(Date),
        issuanceBatchId: 1,
      },
    });

    // Regression guard for D42: draftSecrets is only ever nulled in the SAME
    // update that persists archiveZip — never on its own. Before this task,
    // this exact-shape assertion guarded the opposite invariant (that
    // draftSecrets was NOT nulled while no archive existed); now that the
    // archive is built first and both land in one update, the guard flips to
    // requiring both fields present together.
    expect(issuanceBatchUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        status: 'PUBLISHED',
        rootVersion: 7,
        publishedAt: expect.any(Date),
        archiveExpiresAt: expect.any(Date),
        archiveZip: Buffer.from('PK-archive'),
        draftSecrets: null,
      },
    });

    expect(archiveBuild).toHaveBeenCalledWith({
      batchId: 1,
      rootVersion: 7,
      txHash: undefined,
      publishedAt: expect.any(Date),
      entries: [
        { propertyId: '1001', certificateSerial: 'CERT-2026-001', leaf: '123', files: ['FILE'] },
      ],
    });

    expect(issuedStatements).toHaveBeenCalledWith(
      [{ propertyId: '1001', ownerCommitment: '777', leaf: '123' }],
      { rootVersion: 7, txHash: undefined },
    );
  });

  it('confirm writes only the batch — a plot issued in an earlier round is left alone', async () => {
    const propertyUpdate = jest.fn();
    const prisma = {
      issuanceBatch: {
        findUnique: jest.fn().mockResolvedValue(draftRow()),
        update: jest.fn().mockResolvedValue(undefined),
        create: jest.fn(),
      },
      property: {
        findMany: jest.fn().mockResolvedValue([propertyRow({ propertyId: '1001' })]),
        update: propertyUpdate,
        updateMany: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as never;

    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(999n),
      getRootVersion: jest.fn().mockResolvedValue(7),
    };

    // A property issued in an earlier round — NOT part of this batch's
    // draftSecrets. Deliberately kept separate from the batch's own property
    // so the two sets are visibly different in size and membership.
    const preExisting = propertyRow({
      propertyId: '2002',
      status: 'ISSUED',
      ownerCommitment: 'existing-commitment',
    });
    const nodes = {
      projectRoot: jest.fn().mockResolvedValue(overlayOf(999n)),
      proofInOverlay: jest.fn().mockResolvedValue({ leaf: 123n }),
      applyStatements: jest.fn().mockReturnValue(['APPLY_NODES_STMT']),
    };
    const issuance = {
      commitmentFor: jest.fn().mockResolvedValue(777n),
      batchContext: jest
        .fn()
        .mockReturnValue({ issuer: { ethereumAccount: '0xissuer' }, issuedOn: '2026-09-07' }),
      buildBundleFiles: jest
        .fn()
        .mockResolvedValue({ propertyId: '1001', receipt: {}, files: ['FILE'] }),
    };
    const service = new IssuanceBatchService(
      prisma,
      nodes as never,
      issuance as never,
      chain as never,
      {
        recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
      } as never,
      { assertNoOpenDraft: jest.fn() } as never,
      { issuedStatements: jest.fn().mockReturnValue([]) } as never,
      { build: jest.fn().mockResolvedValue(Buffer.from('PK-archive')) } as never,
    );

    await service.confirm(1);

    // The inversion of the pre-D72 invariant. This used to assert that the
    // cache refresh covered the WHOLE tree — the plot issued in an earlier
    // round included — because publishing a root invalidated every cached
    // proof. That is still true of the tree; what changed is that the tree is
    // the stored thing now, so '2002' is never written and picks up its new
    // path the moment it asks for a proof.
    const updates = nodes.projectRoot.mock.calls[0][0] as Map<number, bigint | null>;
    expect([...updates.keys()]).toEqual([1001]);
    expect(updates.has(Number(preExisting.propertyId))).toBe(false);

    const written = propertyUpdate.mock.calls.map((call) => call[0].where.propertyId);
    expect(written).toEqual(['1001']);
    expect(nodes.applyStatements).toHaveBeenCalledTimes(1);
  });

  it('confirm aborts before writing anything if the rebuilt root no longer matches the signed root', async () => {
    const propertyUpdate = jest.fn();
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      issuanceBatch: {
        findUnique: jest.fn().mockResolvedValue(draftRow()),
        update: jest.fn(),
        create: jest.fn(),
      },
      property: {
        findMany: jest.fn().mockResolvedValue([propertyRow({ propertyId: '1001' })]),
        update: propertyUpdate,
        updateMany: jest.fn(),
      },
      $transaction: transaction,
    } as never;

    const chain = {
      // Matches draft.newRoot, so the FIRST paranoia check (against the chain)
      // passes — this test exercises the SECOND one, after the rebuild.
      getLatestRoot: jest.fn().mockResolvedValue(999n),
      getRootVersion: jest.fn().mockResolvedValue(7),
    };
    const nodes = {
      projectRoot: jest.fn().mockResolvedValue(overlayOf(111n)),
      proofInOverlay: jest.fn().mockResolvedValue({ leaf: 123n }),
      applyStatements: jest.fn().mockReturnValue(['APPLY_NODES_STMT']),
    };
    const issuance = { commitmentFor: jest.fn().mockResolvedValue(777n) };

    const service = new IssuanceBatchService(
      prisma,
      nodes as never,
      issuance as never,
      chain as never,
      { recordRootStatement: jest.fn() } as never,
      { assertNoOpenDraft: jest.fn() } as never,
      { issuedStatements: jest.fn() } as never,
      {} as never,
    );

    await expect(service.confirm(1)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(transaction).not.toHaveBeenCalled();
    expect(propertyUpdate).not.toHaveBeenCalled();
  });

  it('does not clear draftSecrets if the archive fails to build', async () => {
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      issuanceBatch: {
        findUnique: jest.fn().mockResolvedValue(draftRow()),
        update: jest.fn(),
        create: jest.fn(),
      },
      property: {
        findMany: jest.fn().mockResolvedValue([propertyRow({ propertyId: '1001' })]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: transaction,
    } as never;

    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(999n),
      getRootVersion: jest.fn().mockResolvedValue(7),
    };

    const nodes = {
      projectRoot: jest.fn().mockResolvedValue(overlayOf(999n)),
      proofInOverlay: jest.fn().mockResolvedValue({ leaf: 123n }),
      applyStatements: jest.fn().mockReturnValue(['APPLY_NODES_STMT']),
    };

    const issuance = {
      commitmentFor: jest.fn().mockResolvedValue(777n),
      batchContext: jest
        .fn()
        .mockReturnValue({ issuer: { ethereumAccount: '0xissuer' }, issuedOn: '2026-09-07' }),
      buildBundleFiles: jest
        .fn()
        .mockResolvedValue({ propertyId: '1001', receipt: {}, files: ['FILE'] }),
    };

    const archiveBuild = jest.fn().mockRejectedValue(new Error('Archive build failed'));

    const service = new IssuanceBatchService(
      prisma,
      nodes as never,
      issuance as never,
      chain as never,
      {
        recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
      } as never,
      { assertNoOpenDraft: jest.fn() } as never,
      { issuedStatements: jest.fn().mockReturnValue(['EVENT_STMT']) } as never,
      { build: archiveBuild } as never,
    );

    await expect(service.confirm(1)).rejects.toThrow('Archive build failed');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses to discard an issuance batch that is not a draft', async () => {
    const { prisma, findUnique, update } = build();
    findUnique.mockResolvedValue(draftRow({ status: 'PUBLISHED' }));
    const service = new IssuanceBatchService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(service.discard(1)).rejects.toBeInstanceOf(ConflictException);
    // A PUBLISHED batch relabelled DISCARDED, with draftSecrets cleared again,
    // would corrupt the audit trail even though the properties and the
    // on-chain state stay correct.
    expect(update).not.toHaveBeenCalled();
  });

  it('confirm persists the supplied txHash on the batch row and every PropertyEvent row', async () => {
    const issuanceBatchUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      issuanceBatch: {
        findUnique: jest.fn().mockResolvedValue(draftRow()),
        update: issuanceBatchUpdate,
        create: jest.fn(),
      },
      property: {
        findMany: jest.fn().mockResolvedValue([propertyRow({ propertyId: '1001' })]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as never;

    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(999n),
      getRootVersion: jest.fn().mockResolvedValue(7),
    };
    const nodes = {
      projectRoot: jest.fn().mockResolvedValue(overlayOf(999n)),
      proofInOverlay: jest.fn().mockResolvedValue({ leaf: 123n }),
      applyStatements: jest.fn().mockReturnValue(['APPLY_NODES_STMT']),
    };
    const issuance = {
      commitmentFor: jest.fn().mockResolvedValue(777n),
      batchContext: jest
        .fn()
        .mockReturnValue({ issuer: { ethereumAccount: '0xissuer' }, issuedOn: '2026-09-07' }),
      buildBundleFiles: jest
        .fn()
        .mockResolvedValue({ propertyId: '1001', receipt: {}, files: ['FILE'] }),
    };
    const issuedStatements = jest.fn().mockReturnValue(['EVENT_STMT']);

    const service = new IssuanceBatchService(
      prisma,
      nodes as never,
      issuance as never,
      chain as never,
      {
        recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
      } as never,
      { assertNoOpenDraft: jest.fn() } as never,
      { issuedStatements } as never,
      { build: jest.fn().mockResolvedValue(Buffer.from('PK-archive')) } as never,
    );

    await service.confirm(1, '0xdeadbeef');

    expect(issuanceBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ txHash: '0xdeadbeef' }) }),
    );
    expect(issuedStatements).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ txHash: '0xdeadbeef' }),
    );
  });
  describe('draftDetail (D53)', () => {
    const serviceWith = (findUnique: jest.Mock) =>
      new IssuanceBatchService(
        { issuanceBatch: { findUnique } } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { assertNoOpenDraft: jest.fn() } as never,
        {} as never,
        {} as never,
      );

    it('rebuilds an open draft from its stored secrets, in propertyId order', async () => {
      const createdAt = new Date('2026-09-14T02:00:00.000Z');
      // Key order is insertion order in JSON — and "10" < "9" as strings — so
      // the numeric sort is what makes the list stable for the portal.
      const findUnique = jest
        .fn()
        .mockResolvedValue(
          draftRow({
            id: 7,
            newRoot: '555',
            createdAt,
            draftSecrets: { '10': '1', '9': '2', '1001': '3' },
          }),
        );

      await expect(serviceWith(findUnique).draftDetail(7)).resolves.toEqual({
        kind: 'issuance',
        id: 7,
        newRoot: '555',
        createdAt,
        propertyIds: ['9', '10', '1001'],
      });
    });

    it('never exposes the secrets themselves', async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValue(draftRow({ createdAt: new Date(), draftSecrets: { '1001': '424242' } }));

      const detail = await serviceWith(findUnique).draftDetail(1);

      expect(JSON.stringify(detail)).not.toContain('424242');
    });

    it('404s on an unknown batch', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      await expect(serviceWith(findUnique).draftDetail(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s on a batch that is no longer a draft', async () => {
      const findUnique = jest.fn().mockResolvedValue(draftRow({ status: 'PUBLISHED' }));
      await expect(serviceWith(findUnique).draftDetail(1)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
