import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ChangeSetService, MAX_REVOCATIONS_PER_CHANGESET } from './changeset.service';

const propertyRow = (over: Record<string, unknown> = {}) => ({
  propertyId: '1001',
  status: 'ISSUED',
  ownerCommitment: null,
  leaf: null,
  ...over,
});

describe('ChangeSetService (D44)', () => {
  const transferFindMany = jest.fn();
  const revocationFindMany = jest.fn();
  const changeSetFindUnique = jest.fn();
  const changeSetCreate = jest.fn();
  const changeSetUpdate = jest.fn();

  const prisma = {
    transferRequest: { findMany: transferFindMany, update: jest.fn() },
    revocation: { findMany: revocationFindMany, update: jest.fn() },
    changeSet: {
      findUnique: changeSetFindUnique,
      create: changeSetCreate,
      update: changeSetUpdate,
    },
    property: { update: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    transferFindMany.mockResolvedValue([]);
    revocationFindMany.mockResolvedValue([]);
  });

  it('refuses to draft when there is nothing pending', async () => {
    const service = new ChangeSetService(
      prisma,
      { loadIssuedProperties: jest.fn(), buildFrom: jest.fn() } as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
    );

    await expect(service.createDraft()).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns revocation calldata in the exact order the contract expects', async () => {
    revocationFindMany.mockResolvedValue([
      { id: 1, propertyId: '1001', reasonCode: 3, detailHash: '0xaa', detailText: 'x' },
      { id: 2, propertyId: '1002', reasonCode: 1, detailHash: '0xbb', detailText: 'y' },
    ]);
    changeSetCreate.mockResolvedValue({ id: 4, newRoot: '777' });

    const tree = {
      loadIssuedProperties: jest.fn().mockResolvedValue([]),
      buildFrom: jest.fn().mockResolvedValue({ tree: { root: 777n }, properties: [] }),
    };
    const service = new ChangeSetService(
      prisma,
      tree as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
    );

    const draft = await service.createDraft();

    expect(draft.revocationCalldata).toEqual({
      propertyIds: ['1001', '1002'],
      reasonCodes: [3, 1],
      detailHashes: ['0xaa', '0xbb'],
    });
  });

  it('refuses to confirm when the chain root does not match', async () => {
    changeSetFindUnique.mockResolvedValue({
      id: 4,
      status: 'DRAFT',
      newRoot: '777',
      transfers: [],
      revocations: [],
    });
    const chain = { getLatestRoot: jest.fn().mockResolvedValue(999n), getRootVersion: jest.fn() };
    const service = new ChangeSetService(
      prisma,
      {} as never,
      chain as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
    );

    await expect(service.confirm(4)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  /**
   * Shared fixture for the regression guards below: a round with one
   * transfer ('1001') and one revocation ('2002'), plus an untouched property
   * ('3003') that belongs to neither list. '3003' is what lets each test tell
   * "the whole tree" apart from "just this round's batch".
   *
   * `rebuiltRoot` defaults to '555' — the same value the chain and draft.newRoot
   * already agree on — so passing nothing reproduces the original scenario
   * exactly. Overriding it lets a test simulate the DB having drifted between
   * draft creation and confirm, independently of the chain-root check above it.
   */
  function buildConfirmScenario(options: { rebuiltRoot?: bigint } = {}) {
    const { rebuiltRoot = 555n } = options;
    const propertyUpdate = jest.fn();
    const proofCacheStatements = jest.fn().mockResolvedValue([]);
    const changeSetUpdate = jest.fn().mockResolvedValue(undefined);
    const transaction = jest.fn().mockResolvedValue([]);

    const draft = {
      id: 9,
      status: 'DRAFT',
      newRoot: '555',
      txHash: null,
      transfers: [{ id: 1, propertyId: '1001', newOwnerCommitment: '999' }],
      revocations: [
        { id: 2, propertyId: '2002', reasonCode: 3, detailText: 'x', detailHash: '0xaa' },
      ],
    };

    const untouched = propertyRow({ propertyId: '3003', ownerCommitment: 'c-3003' });
    const transferred = propertyRow({ propertyId: '1001', ownerCommitment: '999' });
    // '2002' is deliberately absent — revoked, and therefore dropped from the
    // rebuilt tree entirely.
    const wholeTreeAfterRebuild = [transferred, untouched];

    const prisma = {
      changeSet: {
        findUnique: jest.fn().mockResolvedValue(draft),
        create: jest.fn(),
        update: changeSetUpdate,
      },
      transferRequest: { findMany: jest.fn(), update: jest.fn() },
      revocation: { findMany: jest.fn(), update: jest.fn() },
      property: {
        findMany: jest.fn().mockResolvedValue([
          propertyRow({ propertyId: '1001', ownerCommitment: 'old-1001', leaf: 'leaf-1001-old' }),
          propertyRow({
            propertyId: '2002',
            ownerCommitment: 'commit-2002',
            leaf: 'leaf-2002-old',
          }),
        ]),
        update: propertyUpdate,
      },
      $transaction: transaction,
    } as never;

    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(555n),
      getRootVersion: jest.fn().mockResolvedValue(9),
    };
    const tree = {
      // The plot being revoked is still ISSUED right up until confirm() writes
      // it — that write is what this round is for.
      loadIssuedProperties: jest
        .fn()
        .mockResolvedValue([
          propertyRow({ propertyId: '1001', ownerCommitment: 'old-1001' }),
          propertyRow({ propertyId: '2002', ownerCommitment: 'commit-2002' }),
          untouched,
        ]),
      buildFrom: jest
        .fn()
        .mockResolvedValue({ tree: { root: rebuiltRoot }, properties: wholeTreeAfterRebuild }),
      proofFor: jest.fn().mockResolvedValue({ leaf: 123n }),
    };
    const roots = {
      recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT'),
      proofCacheStatements,
    };
    const events = {
      transferredStatements: jest.fn().mockReturnValue([]),
      revokedStatements: jest.fn().mockReturnValue([]),
    };

    const service = new ChangeSetService(
      prisma,
      tree as never,
      chain as never,
      roots as never,
      { assertNoOpenDraft: jest.fn() } as never,
      events as never,
    );

    return {
      service,
      propertyUpdate,
      proofCacheStatements,
      wholeTreeAfterRebuild,
      changeSetUpdate,
      transaction,
      events,
    };
  }

  it("confirm refreshes the proof cache for the whole rebuilt tree, not just this round's batch", async () => {
    const { service, proofCacheStatements, wholeTreeAfterRebuild } = buildConfirmScenario();

    await service.confirm(9);

    // '3003' is neither transferred nor revoked in this round, yet it must
    // still appear — every published root invalidates every previously cached
    // proof, not only the ones for plots that changed.
    expect(proofCacheStatements).toHaveBeenCalledWith({ root: 555n }, wholeTreeAfterRebuild, 9);
  });

  it("confirm clears a revoked plot's cached leaf, Merkle proof and rootVersion", async () => {
    const { service, propertyUpdate } = buildConfirmScenario();

    await service.confirm(9);

    // A cached path into a tree that no longer contains the leaf is worse than
    // no cache, because it still looks answerable. merkleProof is JSON, so
    // clearing it needs Prisma.DbNull rather than a plain `null`.
    expect(propertyUpdate).toHaveBeenCalledWith({
      where: { propertyId: '2002' },
      data: { status: 'REVOKED', leaf: null, merkleProof: Prisma.DbNull, rootVersion: null },
    });
  });

  it('confirm aborts before writing anything if the rebuilt root no longer matches the signed root', async () => {
    // The chain still agrees with what was signed (555) — this is the SECOND
    // paranoia check, after the DB-driven rebuild disagrees with it (999).
    const { service, transaction } = buildConfirmScenario({ rebuiltRoot: 999n });

    await expect(service.confirm(9)).rejects.toBeInstanceOf(UnprocessableEntityException);
    // Deleting this check would not fail any other test in this file, because
    // every other scenario wires the chain root and the rebuilt root to the
    // same value — this is the one guard against the DB drifting between
    // draft creation and confirm (an out-of-band property edit, say).
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses to discard a change set that is not a draft', async () => {
    changeSetFindUnique.mockResolvedValue({ id: 4, status: 'PUBLISHED' });
    const service = new ChangeSetService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
    );

    await expect(service.discard(4)).rejects.toBeInstanceOf(ConflictException);
    // A PUBLISHED change set relabelled DISCARDED, with its transfers/
    // revocations detached via `set: []`, would corrupt the audit trail even
    // though the on-chain state and the individual rows stay correct.
    expect(changeSetUpdate).not.toHaveBeenCalled();
  });

  it('confirm persists the supplied txHash on the change set row and every PropertyEvent row', async () => {
    const { service, changeSetUpdate, events } = buildConfirmScenario();

    await service.confirm(9, '0xdeadbeef');

    expect(changeSetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ txHash: '0xdeadbeef' }) }),
    );
    expect(events.transferredStatements).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ txHash: '0xdeadbeef' }),
    );
    expect(events.revokedStatements).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ txHash: '0xdeadbeef' }),
    );
  });
  describe('draft discovery (D53) and the revocation cap (D56)', () => {
    const createdAt = new Date('2026-09-14T02:00:00.000Z');
    const revocation = (id: number, propertyId: string) => ({
      id,
      propertyId,
      reasonCode: (id % 5) + 1,
      detailText: `reason ${id}`,
      detailHash: `0x${id.toString(16).padStart(64, '0')}`,
      status: 'PENDING',
      changeSetId: null,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, id)),
    });
    const transfer = { id: 11, propertyId: '5005', newOwnerCommitment: '999' };

    function scenario(pendingRevocations: ReturnType<typeof revocation>[]) {
      const create = jest.fn(async () => ({
        id: 4,
        newRoot: '777',
        status: 'DRAFT',
        createdAt,
      }));
      const findUnique = jest.fn();
      const count = jest.fn();
      const prisma = {
        transferRequest: { findMany: jest.fn().mockResolvedValue([transfer]) },
        revocation: { findMany: jest.fn().mockResolvedValue(pendingRevocations), count },
        changeSet: { create, findUnique },
      } as never;
      const loadIssuedProperties = jest
        .fn()
        .mockResolvedValue(
          pendingRevocations.map((r) => propertyRow({ propertyId: r.propertyId })),
        );
      const buildFrom = jest.fn().mockResolvedValue({ tree: { root: 777n }, properties: [] });
      const service = new ChangeSetService(
        prisma,
        { loadIssuedProperties, buildFrom } as never,
        {} as never,
        {} as never,
        { assertNoOpenDraft: jest.fn() } as never,
        {} as never,
      );
      return { service, create, findUnique, count, buildFrom };
    }

    it('rebuilds exactly what createDraft returned, calldata included', async () => {
      const pending = [revocation(1, '1001'), revocation(2, '1002')];
      const { service, findUnique, count } = scenario(pending);

      const created = await service.createDraft();

      findUnique.mockResolvedValue({
        id: 4,
        status: 'DRAFT',
        newRoot: '777',
        createdAt,
        transfers: [transfer],
        revocations: pending,
      });
      count.mockResolvedValue(0);

      expect(created).toEqual({
        kind: 'changeset',
        id: 4,
        newRoot: '777',
        createdAt,
        transferIds: [11],
        revocationIds: [1, 2],
        revocationCalldata: {
          propertyIds: ['1001', '1002'],
          reasonCodes: [2, 3],
          detailHashes: [pending[0].detailHash, pending[1].detailHash],
        },
        deferredRevocations: 0,
      });
      await expect(service.draftDetail(4)).resolves.toEqual(created);
      // Reads the relations back in the order they were queued, so the
      // calldata a resumed session signs matches the one first shown.
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 4 },
        include: {
          transfers: { orderBy: { createdAt: 'asc' } },
          revocations: { orderBy: { createdAt: 'asc' } },
        },
      });
      expect(count).toHaveBeenCalledWith({ where: { status: 'PENDING', changeSetId: null } });
    });

    it(`takes only the ${MAX_REVOCATIONS_PER_CHANGESET} oldest revocations and defers the rest`, async () => {
      const pending = Array.from({ length: MAX_REVOCATIONS_PER_CHANGESET + 2 }, (_, i) =>
        revocation(i + 1, String(2000 + i)),
      );
      const { service, create, buildFrom } = scenario(pending);

      const draft = await service.createDraft();

      const inRound = pending.slice(0, MAX_REVOCATIONS_PER_CHANGESET);
      expect(draft.revocationIds).toEqual(inRound.map((r) => r.id));
      expect(draft.revocationCalldata.propertyIds).toHaveLength(MAX_REVOCATIONS_PER_CHANGESET);
      expect(draft.deferredRevocations).toBe(2);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revocations: { connect: inRound.map((r) => ({ id: r.id })) },
          }),
        }),
      );
      // The projected root drops ONLY this round's plots: the two deferred
      // ones stay in the tree until their own round publishes.
      const projected = buildFrom.mock.calls[0][0] as { propertyId: string }[];
      expect(projected.map((p) => p.propertyId)).toEqual(
        pending.slice(MAX_REVOCATIONS_PER_CHANGESET).map((r) => r.propertyId),
      );
    });

    it('still refuses a transfer and a revocation for the same plot, even a deferred one', async () => {
      const pending = Array.from({ length: MAX_REVOCATIONS_PER_CHANGESET }, (_, i) =>
        revocation(i + 1, String(2000 + i)),
      );
      pending.push(revocation(99, transfer.propertyId));
      const { service, create } = scenario(pending);

      await expect(service.createDraft()).rejects.toBeInstanceOf(ConflictException);
      expect(create).not.toHaveBeenCalled();
    });

    it('draftDetail 404s on an unknown change set', async () => {
      const { service, findUnique } = scenario([]);
      findUnique.mockResolvedValue(null);
      await expect(service.draftDetail(8)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('draftDetail 409s on a change set that is no longer a draft', async () => {
      const { service, findUnique } = scenario([]);
      findUnique.mockResolvedValue({ id: 8, status: 'PUBLISHED', transfers: [], revocations: [] });
      await expect(service.draftDetail(8)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
