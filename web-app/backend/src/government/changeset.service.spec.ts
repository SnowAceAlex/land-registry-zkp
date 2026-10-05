import {
  ConflictException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ChangeSetService, MAX_REVOCATIONS_PER_CHANGESET } from './changeset.service';
import { makeProperty } from '../../test/factories';

/**
 * A full Property row — `leafUpdatesFor` hashes it through `toLURRecord`, so a
 * minimal stub would throw long before reaching the behaviour under test.
 * `ownerCommitment` stays null by default: a transfer supplies the new one, and
 * a revocation never needs it.
 */
const propertyRow = (over: Record<string, unknown> = {}) =>
  makeProperty({ propertyId: '1001', ownerCommitment: null, leaf: null, ...over } as never);

/** The shape `NodeStoreService.projectRoot` returns. */
const overlayOf = (root: bigint) => ({ root, touched: new Map<string, bigint>(), removed: [] });

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
    // `leafUpdatesFor` reads the plots in the round. These two describes only
    // queue revocations, which need no row (a revocation is `null` at the leaf,
    // not a re-hash), so an empty result is the honest fixture.
    property: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    transferFindMany.mockResolvedValue([]);
    revocationFindMany.mockResolvedValue([]);
  });

  // The portal reads the cap from here rather than keeping a copy (D54's rule):
  // its hardcoded 50 outlived D73 and warned about a cap that had moved.
  it('reports the revocation cap alongside the queue', async () => {
    const service = new ChangeSetService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.pending()).resolves.toEqual({
      transfers: [],
      revocations: [],
      revocationCap: MAX_REVOCATIONS_PER_CHANGESET,
    });
  });

  it('serves the queue without the buyers’ secrets (D77)', async () => {
    transferFindMany.mockResolvedValue([
      {
        id: 1,
        propertyId: '1001',
        newOwnerCommitment: '222',
        newOwnerSecret: '43',
        oldRoot: '5',
        newRoot: '6',
        proof: {},
        publicSignals: [],
        status: 'APPROVED',
        rejectReason: null,
        txHash: null,
        changeSetId: null,
        createdAt: new Date(),
        decidedAt: null,
      },
    ]);
    const service = new ChangeSetService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const { transfers } = await service.pending();

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).not.toHaveProperty('newOwnerSecret');
  });

  it('refuses to draft when there is nothing pending', async () => {
    const service = new ChangeSetService(
      prisma,
      { projectRoot: jest.fn(), applyStatements: jest.fn() } as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
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

    const nodes = {
      projectRoot: jest.fn().mockResolvedValue(overlayOf(777n)),
      applyStatements: jest.fn().mockReturnValue([]),
    };
    const service = new ChangeSetService(
      prisma,
      nodes as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
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
    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(999n),
      // D74 — confirm() always asks the chain itself, never the 2s cache.
      invalidateRootCache: jest.fn(),
      getRootVersion: jest.fn(),
    };
    const service = new ChangeSetService(
      prisma,
      {} as never,
      chain as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
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
  function buildConfirmScenario(options: { rebuiltRoot?: bigint; secret?: string | null } = {}) {
    const { rebuiltRoot = 555n, secret = '43' } = options;
    const propertyUpdate = jest.fn();
    const changeSetUpdate = jest.fn().mockResolvedValue(undefined);
    const transaction = jest.fn().mockResolvedValue([]);
    const transferUpdate = jest.fn();

    const draft = {
      id: 9,
      status: 'DRAFT',
      newRoot: '555',
      txHash: null,
      transfers: [{ id: 1, propertyId: '1001', newOwnerCommitment: '999', newOwnerSecret: secret }],
      revocations: [
        { id: 2, propertyId: '2002', reasonCode: 3, detailText: 'x', detailHash: '0xaa' },
      ],
    };

    const prisma = {
      changeSet: {
        findUnique: jest.fn().mockResolvedValue(draft),
        create: jest.fn(),
        update: changeSetUpdate,
      },
      transferRequest: { findMany: jest.fn(), update: transferUpdate },
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
      // D74 — confirm() always asks the chain itself, never the 2s cache.
      invalidateRootCache: jest.fn(),
      getRootVersion: jest.fn().mockResolvedValue(9),
      rootRegistryAddress: '0xregistry',
      explorerTxUrlPrefix: undefined,
    };
    const projectRoot = jest.fn().mockResolvedValue(overlayOf(rebuiltRoot));
    const applyStatements = jest.fn().mockReturnValue(['APPLY_NODES_STMT']);
    const proofInOverlay = jest.fn().mockResolvedValue({
      leaf: 1n,
      siblings: [],
      pathIndices: [],
      root: rebuiltRoot,
    });
    const nodes = { projectRoot, applyStatements, proofInOverlay };
    const issuance = {
      batchContext: jest
        .fn()
        .mockReturnValue({ issuer: {}, issuedOn: '2026-09-24T10:00:00+07:00' }),
      buildBundleFiles: jest.fn().mockResolvedValue({
        files: [{ name: 'receipt.json', content: '{}' }],
      }),
    };
    const archive = { build: jest.fn().mockResolvedValue(Buffer.from('PK-changeset')) };
    const roots = { recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT') };
    const events = {
      transferredStatements: jest.fn().mockReturnValue([]),
      revokedStatements: jest.fn().mockReturnValue([]),
    };

    const service = new ChangeSetService(
      prisma,
      nodes as never,
      chain as never,
      roots as never,
      { assertNoOpenDraft: jest.fn() } as never,
      events as never,
      issuance as never,
      archive as never,
    );

    return {
      service,
      propertyUpdate,
      transferUpdate,
      projectRoot,
      applyStatements,
      proofInOverlay,
      changeSetUpdate,
      transaction,
      events,
      issuance,
      archive,
      chain,
    };
  }

  it('confirm writes only the plots this round touched — nobody else needs a write', async () => {
    const { service, propertyUpdate, applyStatements } = buildConfirmScenario();

    await service.confirm(9);

    const written = propertyUpdate.mock.calls.map((call) => call[0].where.propertyId).sort();
    expect(written).toEqual(['1001', '2002']);
    // This is the exact inversion of the pre-D72 invariant. It used to be that
    // every published root had to rewrite the cached proof of EVERY issued
    // plot — one leaf changing alters every node on its path, and each other
    // leaf has one sibling on that path. That is still true of the tree; what
    // changed is that the tree is now the stored thing, so '3003' picks up its
    // new proof when it asks, and 2.5 million rows stay untouched.
    expect(written).not.toContain('3003');
    expect(applyStatements).toHaveBeenCalledTimes(1);
  });

  it('confirm projects a removed leaf for a revocation and a new leaf for a transfer', async () => {
    const { service, projectRoot } = buildConfirmScenario();

    await service.confirm(9);

    const updates = projectRoot.mock.calls[0][0] as Map<number, bigint | null>;
    // `null` at the revoked plot IS the enforcement (D45): the node is deleted,
    // so afterwards no Merkle path exists and no circuit can produce a proof
    // for it. The on-chain reason list is auditability, not enforcement.
    expect(updates.get(2002)).toBeNull();
    expect(typeof updates.get(1001)).toBe('bigint');
    expect([...updates.keys()].sort()).toEqual([1001, 2002]);
  });

  it("confirm clears a revoked plot's leaf and root version", async () => {
    const { service, propertyUpdate } = buildConfirmScenario();

    await service.confirm(9);

    // The row must stop claiming a leaf, because `applyStatements` deletes that
    // node in the same transaction. A row asserting a leaf the tree no longer
    // holds is what `NodeStoreService.proofFor` reports as divergence.
    expect(propertyUpdate).toHaveBeenCalledWith({
      where: { propertyId: '2002' },
      data: { status: 'REVOKED', leaf: null, rootVersion: null },
    });
  });

  it('confirm stamps the transferred plot with its new leaf and the published root version', async () => {
    const { service, propertyUpdate } = buildConfirmScenario();

    await service.confirm(9);

    expect(propertyUpdate).toHaveBeenCalledWith({
      where: { propertyId: '1001' },
      data: {
        ownerCommitment: '999',
        leaf: expect.any(String),
        // D72 repurposed this column: it now records the root version in which
        // this leaf last changed, which is what D48's history reads.
        rootVersion: 9,
      },
    });
  });

  it('confirm aborts before writing anything if the reprojected root no longer matches the signed root', async () => {
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
      {} as never,
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
  it("confirm archives each transfer's bundle from the projected tree (D77)", async () => {
    const { service, proofInOverlay, issuance, archive } = buildConfirmScenario();

    await service.confirm(9, '0xfeed');

    // The path comes from the overlay: applyStatements has not run yet, so the
    // node table still describes the tree BEFORE this round.
    expect(proofInOverlay).toHaveBeenCalledTimes(1);
    expect(proofInOverlay.mock.calls[0][0]).toMatchObject({
      propertyId: '1001',
      ownerCommitment: '999',
    });
    expect(issuance.buildBundleFiles).toHaveBeenCalledWith(
      expect.objectContaining({ ownerSecret: 43n }),
      expect.objectContaining({ rootVersion: 9, merkleRoot: 555n, transactionHash: '0xfeed' }),
      expect.anything(),
      expect.any(String),
    );
    expect(archive.build).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'changeset', batchId: 9, rootVersion: 9 }),
    );
  });

  it('confirm writes the archive and clears the secrets in one transaction (D77)', async () => {
    const { service, changeSetUpdate, transferUpdate, transaction } = buildConfirmScenario();

    await service.confirm(9);

    expect(transferUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'PUBLISHED', newOwnerSecret: null }),
    });
    expect(changeSetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          archiveZip: Buffer.from('PK-changeset'),
          archiveExpiresAt: expect.any(Date),
        }),
      }),
    );
    // Both writes are statements of the one $transaction call — the secrets
    // cannot be cleared unless the archive lands with them.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('confirm refuses a transfer that carries no secret, before touching the chain (D77)', async () => {
    const { service, transaction, chain } = buildConfirmScenario({ secret: null });

    await expect(service.confirm(9)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(chain.getLatestRoot).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('a revocation-only round writes no archive', async () => {
    changeSetFindUnique.mockResolvedValue({
      id: 4,
      status: 'DRAFT',
      newRoot: '777',
      txHash: null,
      transfers: [],
      revocations: [{ id: 2, propertyId: '2002', reasonCode: 3, detailHash: '0xaa' }],
    });
    const archive = { build: jest.fn() };
    const service = new ChangeSetService(
      prisma,
      {
        projectRoot: jest.fn().mockResolvedValue(overlayOf(777n)),
        applyStatements: jest.fn().mockReturnValue([]),
      } as never,
      {
        getLatestRoot: jest.fn().mockResolvedValue(777n),
        invalidateRootCache: jest.fn(),
        getRootVersion: jest.fn().mockResolvedValue(5),
      } as never,
      { recordRootStatement: jest.fn() } as never,
      {} as never,
      {
        transferredStatements: jest.fn().mockReturnValue([]),
        revokedStatements: jest.fn().mockReturnValue([]),
      } as never,
      { batchContext: jest.fn() } as never,
      archive as never,
    );

    await service.confirm(4);

    expect(archive.build).not.toHaveBeenCalled();
    expect(changeSetUpdate.mock.calls[0][0].data).not.toHaveProperty('archiveZip');
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
    const transfer = {
      id: 11,
      propertyId: '5005',
      newOwnerCommitment: '999',
      newOwnerSecret: '43',
    };

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
        // The transferred plot has to exist as a full row: its leaf is
        // re-hashed from it, with only ownerCommitment replaced.
        property: {
          findMany: jest.fn().mockResolvedValue([propertyRow({ propertyId: transfer.propertyId })]),
        },
      } as never;
      const projectRoot = jest.fn().mockResolvedValue(overlayOf(777n));
      const service = new ChangeSetService(
        prisma,
        { projectRoot, applyStatements: jest.fn().mockReturnValue([]) } as never,
        {} as never,
        {} as never,
        { assertNoOpenDraft: jest.fn() } as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { service, create, findUnique, count, projectRoot };
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
      const { service, create, projectRoot } = scenario(pending);

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
      // The projection drops ONLY this round's plots: the two deferred ones
      // stay in the tree until their own round publishes. Before D72 this was
      // read off the list handed to buildFrom; now it is read off the update
      // map, which says the same thing in one place instead of by omission.
      const updates = projectRoot.mock.calls[0][0] as Map<number, bigint | null>;
      expect(updates.size).toBe(MAX_REVOCATIONS_PER_CHANGESET + 1); // + the transfer
      for (const r of inRound) expect(updates.get(Number(r.propertyId))).toBeNull();
      for (const r of pending.slice(MAX_REVOCATIONS_PER_CHANGESET)) {
        expect(updates.has(Number(r.propertyId))).toBe(false);
      }
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

describe('ChangeSetService.createDraft — duplicate queue entries', () => {
  /**
   * Found by the bench harness, which writes transfer rows directly and so
   * bypasses the guard in TransfersService.submit(). The draft was correctly
   * refused, but the message said "a transfer and a revocation" for what was in
   * fact two transfers — sending an officer to look for a revocation that does
   * not exist.
   */
  function withQueue(
    transfers: { id: number; propertyId: string; newOwnerCommitment: string }[],
    revocations: { id: number; propertyId: string }[],
  ) {
    const prisma = {
      transferRequest: { findMany: jest.fn().mockResolvedValue(transfers) },
      revocation: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            revocations.map((r) => ({ ...r, reasonCode: 1, detailHash: '0xaa', detailText: 'x' })),
          ),
      },
      changeSet: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      property: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      $transaction: jest.fn(),
    } as never;

    return new ChangeSetService(
      prisma,
      { projectRoot: jest.fn(), applyStatements: jest.fn() } as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('names two transfers for one plot as exactly that', async () => {
    const service = withQueue(
      [
        { id: 1, propertyId: '7', newOwnerCommitment: '111' },
        { id: 2, propertyId: '7', newOwnerCommitment: '222' },
      ],
      [],
    );

    await expect(service.createDraft()).rejects.toThrow(/more than one approved transfer/);
  });

  it('names two revocations for one plot as exactly that', async () => {
    const service = withQueue(
      [],
      [
        { id: 1, propertyId: '7' },
        { id: 2, propertyId: '7' },
      ],
    );

    await expect(service.createDraft()).rejects.toThrow(/more than one pending revocation/);
  });

  it('still reports a genuine transfer-plus-revocation conflict as one', async () => {
    const service = withQueue(
      [{ id: 1, propertyId: '7', newOwnerCommitment: '111' }],
      [{ id: 2, propertyId: '7' }],
    );

    await expect(service.createDraft()).rejects.toThrow(/both a transfer and a revocation pending/);
  });
});

describe('MAX_REVOCATIONS_PER_CHANGESET (D73)', () => {
  it('matches the value whose gas was measured on-chain', () => {
    // Double-entry ledger with BACKEND_CAP in
    // blockchain/test/contracts/RootRegistry.revocation.test.ts. The two
    // packages cannot import each other, so changing one side without the
    // other has to fail HERE rather than at publish time, when the batch would
    // revert wholesale and nothing would be written.
    expect(MAX_REVOCATIONS_PER_CHANGESET).toBe(150);
  });
});

describe('ChangeSetService — a transfer may not resurrect a revoked plot (D45/D72)', () => {
  /**
   * The regression this guards against is specific to D72. Before it, the root
   * was rebuilt from `loadIssuedProperties()`, which filters on ISSUED and so
   * dropped a revoked plot by accident. Projecting from the plots named in the
   * round reads by propertyId and has no such accident, so the rule has to be
   * written down.
   *
   * How it happens: a transfer is APPROVED, then the plot is revoked in a
   * change set that publishes first. The transfer stays APPROVED with
   * changeSetId null, so `pending()` offers it again — and re-hashing its leaf
   * would put back a certificate the State has reclaimed.
   */
  function scenario() {
    const transfer = { id: 7, propertyId: '4004', newOwnerCommitment: '888' };
    const create = jest.fn();
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      transferRequest: { findMany: jest.fn().mockResolvedValue([transfer]), update: jest.fn() },
      revocation: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        count: jest.fn(),
      },
      changeSet: {
        create,
        findUnique: jest.fn().mockResolvedValue({
          id: 12,
          status: 'DRAFT',
          newRoot: '555',
          txHash: null,
          transfers: [transfer],
          revocations: [],
        }),
        update: jest.fn(),
      },
      property: {
        findMany: jest
          .fn()
          .mockResolvedValue([propertyRow({ propertyId: '4004', status: 'REVOKED' })]),
        update: jest.fn(),
      },
      $transaction: transaction,
    } as never;

    const service = new ChangeSetService(
      prisma,
      {
        projectRoot: jest.fn().mockResolvedValue(overlayOf(555n)),
        applyStatements: jest.fn().mockReturnValue([]),
      } as never,
      {
        getLatestRoot: jest.fn().mockResolvedValue(555n),
        // D74 — confirm() always asks the chain itself, never the 2s cache.
        invalidateRootCache: jest.fn(),
        getRootVersion: jest.fn().mockResolvedValue(9),
      } as never,
      { recordRootStatement: jest.fn() } as never,
      { assertNoOpenDraft: jest.fn() } as never,
      { transferredStatements: jest.fn(), revokedStatements: jest.fn() } as never,
      {} as never,
      {} as never,
    );
    return { service, create, transaction };
  }

  it('refuses to draft a round whose transfer targets a revoked plot', async () => {
    const { service, create } = scenario();

    await expect(service.createDraft()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to confirm one too, even if the chain root agrees', async () => {
    const { service, transaction } = scenario();

    await expect(service.confirm(12)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('ChangeSetService — buyer secrets and the archive (D77)', () => {
  it('createDraft refuses transfers submitted before D77 and names them', async () => {
    const prisma = {
      transferRequest: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 5, propertyId: '7', newOwnerCommitment: '1', newOwnerSecret: null },
          ]),
      },
      revocation: { findMany: jest.fn().mockResolvedValue([]) },
      changeSet: { create: jest.fn() },
    };
    const service = new ChangeSetService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { assertNoOpenDraft: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.createDraft()).rejects.toThrow(/#5/);
    expect(prisma.changeSet.create).not.toHaveBeenCalled();
  });

  it('list returns summary columns and counts, never the archive', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 3,
        status: 'PUBLISHED',
        newRoot: '1',
        rootVersion: 4,
        txHash: null,
        createdAt: new Date(),
        publishedAt: new Date(),
        archiveExpiresAt: new Date(),
        _count: { transfers: 2, revocations: 1 },
      },
    ]);
    const service = new ChangeSetService(
      { changeSet: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const [row] = await service.list();

    expect(row).toMatchObject({ id: 3, transferCount: 2, revocationCount: 1 });
    expect(row).not.toHaveProperty('_count');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('archiveZip');
  });

  it('archiveFor 404s without an archive and 410s + drops it once expired', async () => {
    const findUnique = jest.fn();
    const update = jest.fn();
    const service = new ChangeSetService(
      { changeSet: { findUnique, update } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    findUnique.mockResolvedValue({ archiveZip: null, archiveExpiresAt: null });
    await expect(service.archiveFor(3)).rejects.toBeInstanceOf(NotFoundException);

    findUnique.mockResolvedValue({
      archiveZip: Buffer.from('PK'),
      archiveExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.archiveFor(3)).rejects.toBeInstanceOf(GoneException);
    expect(update).toHaveBeenCalledWith({ where: { id: 3 }, data: { archiveZip: null } });

    findUnique.mockResolvedValue({
      archiveZip: Buffer.from('PK'),
      archiveExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.archiveFor(3)).resolves.toEqual({
      zip: Buffer.from('PK'),
      filename: 'changeset-3.zip',
    });
  });
});
