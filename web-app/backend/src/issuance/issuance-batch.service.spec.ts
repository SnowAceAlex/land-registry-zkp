import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { IssuanceBatchService } from './issuance-batch.service';

const draftRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  status: 'DRAFT',
  newRoot: '999',
  draftSecrets: { '1001': '42' },
  properties: [{ propertyId: '1001' }],
  ...over,
});

const propertyRow = (over: Record<string, unknown> = {}) => ({
  propertyId: '1001',
  status: 'IMPORTED',
  ownerCommitment: null,
  certificateSerial: 'CERT-2026-001',
  ...over,
});

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
    const batchCreate = jest.fn().mockResolvedValue({
      id: 42,
      newRoot: '555',
      status: 'DRAFT',
      draftSecrets: { '1001': '111', '1002': '222' },
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

    const tree = {
      loadIssuedProperties: jest.fn().mockResolvedValue([]),
      buildFrom: jest.fn().mockResolvedValue({ tree: { root: 555n }, properties: [] }),
    };
    const issuance = {
      generateOwnerSecret: jest.fn().mockReturnValueOnce(111n).mockReturnValueOnce(222n),
      commitmentFor: jest.fn((secret: bigint) => Promise.resolve(secret + 1000n)),
    };

    const service = new IssuanceBatchService(
      prisma,
      tree as never,
      issuance as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    const result = await service.createDraft(['1001', '1002']);

    expect(result).toEqual({ id: 42, newRoot: '555', propertyIds: ['1001', '1002'] });
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
    const tree = {
      loadIssuedProperties: jest.fn().mockResolvedValue([]),
      buildFrom: jest.fn().mockResolvedValue({
        tree: { root: 999n },
        properties: [propertyRow({ propertyId: '1001', ownerCommitment: '777' })],
      }),
      proofFor: jest.fn().mockResolvedValue({ leaf: 123n }),
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
      tree as never,
      issuance as never,
      chain as never,
      {
        recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
        proofCacheStatements: jest.fn().mockResolvedValue(['PROOF_CACHE_STMT']),
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

  it('confirm refreshes the proof cache for every issued property, not just the batch', async () => {
    const prisma = {
      issuanceBatch: {
        findUnique: jest.fn().mockResolvedValue(draftRow()),
        update: jest.fn().mockResolvedValue(undefined),
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

    // A property issued in an earlier round — NOT part of this batch's
    // draftSecrets. Deliberately kept separate from the batch's own property
    // so the two sets are visibly different in size and membership.
    const preExisting = propertyRow({
      propertyId: '2002',
      status: 'ISSUED',
      ownerCommitment: 'existing-commitment',
    });
    const wholeTreeAfterRebuild = [
      preExisting,
      propertyRow({ propertyId: '1001', ownerCommitment: '777' }),
    ];

    const buildFrom = jest.fn().mockResolvedValue({
      tree: { root: 999n },
      properties: wholeTreeAfterRebuild,
    });
    const tree = {
      loadIssuedProperties: jest.fn().mockResolvedValue([preExisting]),
      buildFrom,
      proofFor: jest.fn().mockResolvedValue({ leaf: 123n }),
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
    const proofCacheStatements = jest.fn().mockResolvedValue([]);

    const service = new IssuanceBatchService(
      prisma,
      tree as never,
      issuance as never,
      chain as never,
      {
        recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
        proofCacheStatements,
      } as never,
      { assertNoOpenDraft: jest.fn() } as never,
      { issuedStatements: jest.fn().mockReturnValue([]) } as never,
      { build: jest.fn().mockResolvedValue(Buffer.from('PK-archive')) } as never,
    );

    await service.confirm(1);

    // buildFrom must see BOTH the pre-existing issued property and the batch —
    // dropping either would silently shrink the published tree.
    expect(buildFrom).toHaveBeenCalledWith([
      preExisting,
      expect.objectContaining({ propertyId: '1001', ownerCommitment: '777' }),
    ]);

    // The cache refresh must cover the WHOLE rebuilt tree (both properties),
    // not just the batch (one property) — every published root invalidates
    // every previously cached proof, not only the ones that changed.
    expect(proofCacheStatements).toHaveBeenCalledWith({ root: 999n }, wholeTreeAfterRebuild, 7);
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
    const tree = {
      loadIssuedProperties: jest.fn().mockResolvedValue([]),
      // Something changed underneath the draft: the rebuilt root disagrees
      // with the root that was actually signed.
      buildFrom: jest.fn().mockResolvedValue({ tree: { root: 111n }, properties: [] }),
      proofFor: jest.fn(),
    };
    const issuance = { commitmentFor: jest.fn().mockResolvedValue(777n) };

    const service = new IssuanceBatchService(
      prisma,
      tree as never,
      issuance as never,
      chain as never,
      { recordRootStatement: jest.fn(), proofCacheStatements: jest.fn() } as never,
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

    const tree = {
      loadIssuedProperties: jest.fn().mockResolvedValue([]),
      buildFrom: jest.fn().mockResolvedValue({
        tree: { root: 999n },
        properties: [propertyRow({ propertyId: '1001', ownerCommitment: '777' })],
      }),
      proofFor: jest.fn().mockResolvedValue({ leaf: 123n }),
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
      tree as never,
      issuance as never,
      chain as never,
      {
        recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
        proofCacheStatements: jest.fn().mockResolvedValue(['PROOF_CACHE_STMT']),
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
    const tree = {
      loadIssuedProperties: jest.fn().mockResolvedValue([]),
      buildFrom: jest.fn().mockResolvedValue({
        tree: { root: 999n },
        properties: [propertyRow({ propertyId: '1001', ownerCommitment: '777' })],
      }),
      proofFor: jest.fn().mockResolvedValue({ leaf: 123n }),
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
      tree as never,
      issuance as never,
      chain as never,
      {
        recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
        proofCacheStatements: jest.fn().mockResolvedValue(['PROOF_CACHE_STMT']),
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
});
