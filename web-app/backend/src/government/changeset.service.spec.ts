import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { hashRecord } from '@land-registry/blockchain/shared';

import { ChangeSetService, DEFAULT_REVOCATION_CAP, revocationCap } from './changeset.service';
import { ARCHIVE_TTL_DAYS } from '../issuance/archive.service';
import { LineageService } from '../lineage/lineage.service';
import { toLURRecord } from '../records/record.mapper';
import { BRANCH_ACTOR, CENTRAL_ACTOR, makeProperty } from '../../test/factories';

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

/** A write that returns a labelled statement, so a test can see what shares a $transaction. */
const tagged = (label: string) => jest.fn((args: any) => ({ label, args }));

const OFFICES = [
  { id: 1, code: 'HQ' },
  { id: 9, code: 'CN01' },
];
const OFFICE_ARCHIVE = {
  officeId: 9,
  officeCode: 'CN01',
  zip: Buffer.from('PK-changeset'),
  propertyCount: 1,
};

// revocationCap() reads the env at call time; keep every test on the default unless it sets one.
const savedCap = process.env.REVOCATION_CAP;
beforeEach(() => {
  delete process.env.REVOCATION_CAP;
});
afterAll(() => {
  if (savedCap === undefined) delete process.env.REVOCATION_CAP;
  else process.env.REVOCATION_CAP = savedCap;
});

describe('ChangeSetService (D44)', () => {
  const issuanceFindMany = jest.fn();
  const transferFindMany = jest.fn();
  const revocationFindMany = jest.fn();
  const changeSetFindUnique = jest.fn();
  const changeSetCreate = jest.fn();
  const changeSetUpdate = jest.fn();

  const prisma = {
    issuanceRequest: { findMany: issuanceFindMany, update: jest.fn() },
    transferRequest: { findMany: transferFindMany, update: jest.fn() },
    revocation: { findMany: revocationFindMany, update: jest.fn() },
    landOffice: { findMany: jest.fn().mockResolvedValue([{ id: 9, code: 'CN01' }]) },
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
    issuanceFindMany.mockResolvedValue([]);
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
      {} as never,
    );

    await expect(service.pending(CENTRAL_ACTOR)).resolves.toEqual({
      issuances: [],
      transfers: [],
      revocations: [],
      revocationCap: DEFAULT_REVOCATION_CAP,
    });
  });

  it('reports the cap REVOCATION_CAP sets', async () => {
    process.env.REVOCATION_CAP = '60';
    const service = new ChangeSetService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.pending(CENTRAL_ACTOR)).resolves.toMatchObject({ revocationCap: 60 });
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
        officeId: 9,
        landOfficeId: 9,
        heldAt: null,
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
      {} as never,
    );

    const { transfers } = await service.pending(CENTRAL_ACTOR);

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).not.toHaveProperty('newOwnerSecret');
    expect(transfers[0].officeCode).toBe('CN01');
  });

  it('serves issuance requests without their owner secrets (D87)', async () => {
    issuanceFindMany.mockResolvedValue([
      {
        id: 21,
        propertyId: '6006',
        ownerSecret: '77',
        ownerCommitment: '888',
        status: 'READY',
        officeId: 9,
        landOfficeId: 9,
        heldAt: null,
        heldReason: null,
        changeSetId: null,
        createdAt: new Date(),
        publishedAt: null,
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
      {} as never,
    );

    const { issuances } = await service.pending(CENTRAL_ACTOR);

    expect(issuances).toHaveLength(1);
    expect(issuances[0]).not.toHaveProperty('ownerSecret');
    expect(issuances[0]).toMatchObject({ id: 21, propertyId: '6006', ownerCommitment: '888' });
  });

  it('scopes all three lists to a branch’s own area, and none for the central office (D86)', async () => {
    const service = new ChangeSetService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.pending(BRANCH_ACTOR);
    for (const findMany of [issuanceFindMany, transferFindMany, revocationFindMany]) {
      expect(findMany.mock.calls[0][0].where).toMatchObject({
        landOfficeId: BRANCH_ACTOR.officeId,
      });
    }

    jest.clearAllMocks();
    await service.pending(CENTRAL_ACTOR);
    for (const findMany of [issuanceFindMany, transferFindMany, revocationFindMany]) {
      expect(findMany.mock.calls[0][0].where).not.toHaveProperty('landOfficeId');
    }
  });

  it('queues items not yet in a draft, and serves only the ones not held (D87)', async () => {
    const held = new Date('2026-10-15T03:00:00.000Z');
    issuanceFindMany.mockResolvedValue([
      { id: 21, propertyId: '6006', officeId: 1, landOfficeId: null, heldAt: held },
    ]);
    revocationFindMany.mockResolvedValue([
      { id: 2, propertyId: '2002', heldAt: held },
      { id: 3, propertyId: '2003', heldAt: null },
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
      {} as never,
    );

    const pending = await service.pending(CENTRAL_ACTOR);

    expect(issuanceFindMany.mock.calls[0][0]).toEqual({
      where: { status: 'READY', changeSetId: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(transferFindMany.mock.calls[0][0]).toEqual({
      where: { status: 'APPROVED', changeSetId: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(revocationFindMany.mock.calls[0][0]).toEqual({
      where: { status: 'PENDING', changeSetId: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(pending.issuances).toEqual([]);
    expect(pending.revocations.map((r) => r.id)).toEqual([3]);
    // Serialized with office codes, not the raw row.
    expect(pending.revocations[0]).not.toHaveProperty('officeId');
    expect(pending.revocations[0]).toHaveProperty('officeCode');
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
      {} as never,
    );

    await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns revocation calldata in the exact order the contract expects', async () => {
    revocationFindMany.mockResolvedValue([
      {
        id: 1,
        propertyId: '1001',
        reasonCode: 3,
        detailHash: '0xaa',
        detailText: 'x',
        heldAt: null,
      },
      {
        id: 2,
        propertyId: '1002',
        reasonCode: 1,
        detailHash: '0xbb',
        detailText: 'y',
        heldAt: null,
      },
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
      {} as never,
    );

    const draft = await service.createDraft(CENTRAL_ACTOR);

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
      issuances: [],
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
      {} as never,
    );

    await expect(service.confirm(4, undefined, CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  /**
   * Shared fixture for the regression guards below: a round with one
   * transfer ('1001') and one revocation ('2002'), plus an untouched property
   * ('3003') that belongs to neither list. '3003' is what lets each test tell
   * "the whole tree" apart from "just this round's batch".
   *
   * `rebuiltRoot` defaults to '555' — the same value the chain and draft.newRoot
   * already agree on. Overriding it simulates the DB drifting between draft
   * creation and confirm, independently of the chain-root check above it.
   */
  function buildConfirmScenario(options: { rebuiltRoot?: bigint; secret?: string | null } = {}) {
    const { rebuiltRoot = 555n, secret = '43' } = options;
    const propertyUpdate = jest.fn();
    const changeSetUpdate = tagged('changeSet.update');
    const archiveCreate = tagged('changeSetArchive.create');
    const transaction = jest.fn().mockResolvedValue([]);
    const transferUpdate = tagged('transferRequest.update');

    const draft = {
      id: 9,
      status: 'DRAFT',
      newRoot: '555',
      txHash: null,
      issuances: [],
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
      changeSetArchive: { create: archiveCreate },
      landOffice: { findMany: jest.fn().mockResolvedValue(OFFICES) },
      issuanceRequest: { findMany: jest.fn(), update: jest.fn() },
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
    const issuance = { commitmentFor: jest.fn() };
    const roundArchives = { build: jest.fn().mockResolvedValue([OFFICE_ARCHIVE]) };
    const roots = { recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT') };
    const events = {
      issuedStatements: jest.fn().mockReturnValue([]),
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
      roundArchives as never,
      {} as never,
    );

    return {
      service,
      propertyUpdate,
      transferUpdate,
      projectRoot,
      applyStatements,
      changeSetUpdate,
      archiveCreate,
      transaction,
      events,
      roundArchives,
      chain,
    };
  }

  it('confirm writes only the plots this round touched — nobody else needs a write', async () => {
    const { service, propertyUpdate, applyStatements } = buildConfirmScenario();

    await service.confirm(9, undefined, CENTRAL_ACTOR);

    const written = propertyUpdate.mock.calls.map((call) => call[0].where.propertyId).sort();
    expect(written).toEqual(['1001', '2002']);
    // D72: the tree is the stored thing, so '3003' picks up its new proof when
    // it asks — a publish no longer rewrites every other plot's cached proof.
    expect(written).not.toContain('3003');
    expect(applyStatements).toHaveBeenCalledTimes(1);
  });

  it('confirm projects a removed leaf for a revocation and a new leaf for a transfer', async () => {
    const { service, projectRoot } = buildConfirmScenario();

    await service.confirm(9, undefined, CENTRAL_ACTOR);

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

    await service.confirm(9, undefined, CENTRAL_ACTOR);

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

    await service.confirm(9, undefined, CENTRAL_ACTOR);

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

    await expect(service.confirm(9, undefined, CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    // The one guard against the DB drifting between draft creation and confirm
    // (an out-of-band property edit, say): every other scenario agrees on 555.
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
      {} as never,
    );

    await expect(service.discard(4)).rejects.toBeInstanceOf(ConflictException);
    // Relabelling a PUBLISHED change set and detaching its items would corrupt
    // the audit trail even though the chain and the individual rows stay right.
    expect(changeSetUpdate).not.toHaveBeenCalled();
  });

  it('discard releases all three kinds of item back to the queue', async () => {
    changeSetFindUnique.mockResolvedValue({ id: 4, status: 'DRAFT' });
    const service = new ChangeSetService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.discard(4);

    expect(changeSetUpdate).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        status: 'DISCARDED',
        issuances: { set: [] },
        transfers: { set: [] },
        revocations: { set: [] },
      },
    });
  });

  it('confirm persists the supplied txHash on the change set row and every PropertyEvent row', async () => {
    const { service, changeSetUpdate, events } = buildConfirmScenario();

    await service.confirm(9, '0xdeadbeef', CENTRAL_ACTOR);

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

  it('confirm stamps the confirming office on the change set (D86)', async () => {
    const { service, changeSetUpdate } = buildConfirmScenario();

    await service.confirm(9, undefined, { ...CENTRAL_ACTOR, officeId: 2 });

    expect(changeSetUpdate.mock.calls[0][0].data).toMatchObject({ confirmedByOfficeId: 2 });
  });

  it('confirm hands the round to the archive builder with the projected tree and the office map (D88)', async () => {
    const { service, roundArchives } = buildConfirmScenario();

    await service.confirm(9, '0xfeed', CENTRAL_ACTOR);

    expect(roundArchives.build).toHaveBeenCalledTimes(1);
    expect(roundArchives.build).toHaveBeenCalledWith(
      expect.objectContaining({
        changeSetId: 9,
        txHash: '0xfeed',
        rootVersion: 9,
        overlay: expect.objectContaining({ root: 555n }),
        transfers: [expect.objectContaining({ propertyId: '1001', newOwnerSecret: '43' })],
        offices: new Map([
          [1, 'HQ'],
          [9, 'CN01'],
        ]),
      }),
    );
  });

  it('confirm writes each office archive and clears the secrets in one transaction (D77, D88)', async () => {
    const { service, transaction, archiveCreate } = buildConfirmScenario();

    await service.confirm(9, undefined, CENTRAL_ACTOR);

    expect(archiveCreate).toHaveBeenCalledWith({
      data: {
        changeSetId: 9,
        officeId: 9,
        zip: Buffer.from('PK-changeset'),
        propertyCount: 1,
        expiresAt: expect.any(Date),
      },
    });
    // The archive row and the secret-clearing statements are elements of the ONE
    // $transaction array — the secrets cannot be cleared unless the archive lands.
    expect(transaction).toHaveBeenCalledTimes(1);
    const statements = transaction.mock.calls[0][0] as { label: string; args: unknown }[];
    expect(statements.map((st) => st?.label)).toEqual(
      expect.arrayContaining(['transferRequest.update', 'changeSetArchive.create']),
    );
    expect(statements).toContainEqual({
      label: 'transferRequest.update',
      args: {
        where: { id: 1 },
        data: expect.objectContaining({ status: 'PUBLISHED', newOwnerSecret: null }),
      },
    });
  });

  it('confirm writes one archive row per office, expiring after the TTL (D88)', async () => {
    const { service, archiveCreate, roundArchives } = buildConfirmScenario();
    roundArchives.build.mockResolvedValue([
      OFFICE_ARCHIVE,
      { officeId: 1, officeCode: 'HQ', zip: Buffer.from('PK-hq'), propertyCount: 2 },
    ]);
    const now = new Date('2026-10-15T03:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(now);

    try {
      await service.confirm(9, undefined, CENTRAL_ACTOR);
    } finally {
      jest.useRealTimers();
    }

    expect(archiveCreate.mock.calls.map((c) => c[0].data.officeId)).toEqual([9, 1]);
    // decidedAt (frozen) + exactly ARCHIVE_TTL_DAYS days, the same on every office row.
    const expected = new Date(now.getTime() + ARCHIVE_TTL_DAYS * 24 * 60 * 60 * 1000);
    expect(archiveCreate.mock.calls.map((c) => c[0].data.expiresAt)).toEqual([expected, expected]);
  });

  it('confirm refuses a transfer that carries no secret, before touching the chain (D77)', async () => {
    const { service, transaction, chain } = buildConfirmScenario({ secret: null });

    await expect(service.confirm(9, undefined, CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(chain.getLatestRoot).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('a revocation-only round writes no archive row', async () => {
    changeSetFindUnique.mockResolvedValue({
      id: 4,
      status: 'DRAFT',
      newRoot: '777',
      txHash: null,
      issuances: [],
      transfers: [],
      revocations: [{ id: 2, propertyId: '2002', reasonCode: 3, detailHash: '0xaa' }],
    });
    const roundArchives = { build: jest.fn() };
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
        issuedStatements: jest.fn().mockReturnValue([]),
        transferredStatements: jest.fn().mockReturnValue([]),
        revokedStatements: jest.fn().mockReturnValue([]),
      } as never,
      {} as never,
      roundArchives as never,
      {} as never,
    );

    await service.confirm(4, undefined, CENTRAL_ACTOR);

    expect(roundArchives.build).not.toHaveBeenCalled();
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
      heldAt: null as Date | null,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, id)),
    });
    const transfer = {
      id: 11,
      propertyId: '5005',
      newOwnerCommitment: '999',
      newOwnerSecret: '43',
      heldAt: null,
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
        issuanceRequest: { findMany: jest.fn().mockResolvedValue([]) },
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
        {} as never,
      );
      return { service, create, findUnique, count, projectRoot };
    }

    it('rebuilds exactly what createDraft returned, calldata included', async () => {
      const pending = [revocation(1, '1001'), revocation(2, '1002')];
      const { service, findUnique, count } = scenario(pending);

      const created = await service.createDraft(CENTRAL_ACTOR);

      findUnique.mockResolvedValue({
        id: 4,
        status: 'DRAFT',
        newRoot: '777',
        createdAt,
        issuances: [],
        transfers: [transfer],
        revocations: pending,
      });
      count.mockResolvedValue(0);

      expect(created).toEqual({
        kind: 'changeset',
        id: 4,
        newRoot: '777',
        createdAt,
        issuanceRequestIds: [],
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
          issuances: { orderBy: { createdAt: 'asc' } },
          transfers: { orderBy: { createdAt: 'asc' } },
          revocations: { orderBy: { createdAt: 'asc' } },
        },
      });
      // A held revocation was not left out by the cap, so it is not "deferred".
      expect(count).toHaveBeenCalledWith({
        where: { status: 'PENDING', changeSetId: null, heldAt: null },
      });
    });

    it(`takes only the ${DEFAULT_REVOCATION_CAP} oldest revocations and defers the rest`, async () => {
      const pending = Array.from({ length: DEFAULT_REVOCATION_CAP + 2 }, (_, i) =>
        revocation(i + 1, String(2000 + i)),
      );
      const { service, create, projectRoot } = scenario(pending);

      const draft = await service.createDraft(CENTRAL_ACTOR);

      const inRound = pending.slice(0, DEFAULT_REVOCATION_CAP);
      expect(draft.revocationIds).toEqual(inRound.map((r) => r.id));
      expect(draft.revocationCalldata.propertyIds).toHaveLength(DEFAULT_REVOCATION_CAP);
      expect(draft.deferredRevocations).toBe(2);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revocations: { connect: inRound.map((r) => ({ id: r.id })) },
          }),
        }),
      );
      // The projection drops ONLY this round's plots: the two deferred ones
      // stay in the tree until their own round publishes.
      const updates = projectRoot.mock.calls[0][0] as Map<number, bigint | null>;
      expect(updates.size).toBe(DEFAULT_REVOCATION_CAP + 1); // + the transfer
      for (const r of inRound) expect(updates.get(Number(r.propertyId))).toBeNull();
      for (const r of pending.slice(DEFAULT_REVOCATION_CAP)) {
        expect(updates.has(Number(r.propertyId))).toBe(false);
      }
    });

    it('takes the cap REVOCATION_CAP sets at the time of the call', async () => {
      process.env.REVOCATION_CAP = '2';
      const pending = [revocation(1, '2001'), revocation(2, '2002'), revocation(3, '2003')];
      const { service } = scenario(pending);

      const draft = await service.createDraft(CENTRAL_ACTOR);

      expect(draft.revocationIds).toEqual([1, 2]);
      expect(draft.deferredRevocations).toBe(1);
    });

    it('leaves a held revocation out of the round and out of the deferred count', async () => {
      const held = { ...revocation(2, '2002'), heldAt: new Date() };
      const { service, create } = scenario([revocation(1, '2001'), held, revocation(3, '2003')]);

      const draft = await service.createDraft(CENTRAL_ACTOR);

      expect(draft.revocationIds).toEqual([1, 3]);
      expect(draft.deferredRevocations).toBe(0);
      expect(create.mock.calls[0]).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ revocations: { connect: [{ id: 1 }, { id: 3 }] } }),
        }),
      ]);
    });

    it('still refuses a transfer and a revocation for the same plot, even a deferred one', async () => {
      const pending = Array.from({ length: DEFAULT_REVOCATION_CAP }, (_, i) =>
        revocation(i + 1, String(2000 + i)),
      );
      pending.push(revocation(99, transfer.propertyId));
      const { service, create } = scenario(pending);

      await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(create).not.toHaveBeenCalled();
    });

    it('draftDetail 404s on an unknown change set', async () => {
      const { service, findUnique } = scenario([]);
      findUnique.mockResolvedValue(null);
      await expect(service.draftDetail(8)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('draftDetail 409s on a change set that is no longer a draft', async () => {
      const { service, findUnique } = scenario([]);
      findUnique.mockResolvedValue({
        id: 8,
        status: 'PUBLISHED',
        issuances: [],
        transfers: [],
        revocations: [],
      });
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
    revocations: { id: number; propertyId: string; heldAt?: Date }[],
  ) {
    const prisma = {
      issuanceRequest: { findMany: jest.fn().mockResolvedValue([]) },
      transferRequest: {
        findMany: jest.fn().mockResolvedValue(transfers.map((t) => ({ heldAt: null, ...t }))),
      },
      revocation: {
        findMany: jest.fn().mockResolvedValue(
          revocations.map((r) => ({
            heldAt: null,
            ...r,
            reasonCode: 1,
            detailHash: '0xaa',
            detailText: 'x',
          })),
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

    await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toThrow(
      /more than one approved transfer/,
    );
  });

  it('names two revocations for one plot as exactly that', async () => {
    const service = withQueue(
      [],
      [
        { id: 1, propertyId: '7' },
        { id: 2, propertyId: '7' },
      ],
    );

    await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toThrow(
      /more than one pending revocation/,
    );
  });

  it('still reports a genuine transfer-plus-revocation conflict as one', async () => {
    const service = withQueue(
      [{ id: 1, propertyId: '7', newOwnerCommitment: '111' }],
      [{ id: 2, propertyId: '7' }],
    );

    await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toThrow(
      /both a transfer and a revocation pending/,
    );
  });

  it('still refuses a transfer whose plot has a held revocation — held is still open (D87)', async () => {
    const service = withQueue(
      [{ id: 1, propertyId: '7', newOwnerCommitment: '111' }],
      [{ id: 2, propertyId: '7', heldAt: new Date() }],
    );

    const attempt = service.createDraft(CENTRAL_ACTOR);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(/both a transfer and a revocation pending/);
  });
});

describe('DEFAULT_REVOCATION_CAP (D73)', () => {
  it('matches the value whose gas was measured on-chain', () => {
    // Double-entry ledger with BACKEND_CAP in
    // blockchain/test/contracts/RootRegistry.revocation.test.ts: the two
    // packages cannot import each other, so a change on one side fails here.
    expect(DEFAULT_REVOCATION_CAP).toBe(150);
  });
});

describe('revocationCap() — REVOCATION_CAP from the env', () => {
  it.each([
    [undefined, 150],
    ['60', 60],
    [' 60 ', 60],
    ['abc', 150],
    ['0', 150],
    ['-5', 150],
    ['1.5', 150],
    ['', 150],
  ])('REVOCATION_CAP=%p → %p', (raw, expected) => {
    if (raw === undefined) delete process.env.REVOCATION_CAP;
    else process.env.REVOCATION_CAP = raw;
    expect(revocationCap()).toBe(expected);
  });
});

describe('ChangeSetService — a transfer may not resurrect a revoked plot (D45/D72)', () => {
  /**
   * D72 projects from the plots named in the round, reading by propertyId, so
   * nothing filters a revoked plot out by accident any more. How it happens: a
   * transfer is APPROVED, then the plot is revoked in a change set that
   * publishes first; the transfer stays APPROVED with changeSetId null, and
   * re-hashing its leaf would put back a certificate the State has reclaimed.
   */
  function scenario() {
    const transfer = { id: 7, propertyId: '4004', newOwnerCommitment: '888', heldAt: null };
    const create = jest.fn();
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      issuanceRequest: { findMany: jest.fn().mockResolvedValue([]) },
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
          issuances: [],
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
      {} as never,
    );
    return { service, create, transaction };
  }

  it('refuses to draft a round whose transfer targets a revoked plot', async () => {
    const { service, create } = scenario();

    await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to confirm one too, even if the chain root agrees', async () => {
    const { service, transaction } = scenario();

    await expect(service.confirm(12, undefined, CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('ChangeSetService — issuance in the round (D84)', () => {
  const createdAt = new Date('2026-10-15T02:00:00.000Z');
  const issuanceRequest = (over: Record<string, unknown> = {}) => ({
    id: 21,
    propertyId: '6006',
    ownerSecret: '77',
    ownerCommitment: '888',
    status: 'READY',
    officeId: 1,
    landOfficeId: 9,
    heldAt: null,
    heldReason: null,
    changeSetId: null,
    createdAt: new Date('2026-10-15T01:00:00.000Z'),
    publishedAt: null,
    ...over,
  });
  const importedPlot = (propertyId = '6006', over: Record<string, unknown> = {}) =>
    propertyRow({ propertyId, status: 'IMPORTED', ownerCommitment: null, issuedAt: null, ...over });

  /** Each write returns a tagged statement, so a test can see which ones share the $transaction. */
  const statement = (label: string) => jest.fn((args: unknown) => ({ label, args }));

  function scenario(
    options: {
      issuances?: ReturnType<typeof issuanceRequest>[];
      transfers?: {
        id: number;
        propertyId: string;
        newOwnerCommitment: string;
        newOwnerSecret: string | null;
      }[];
      revocations?: { id: number; propertyId: string; reasonCode: number; detailHash: string }[];
      properties?: ReturnType<typeof propertyRow>[];
      unrevoked?: Map<string, string[]>;
    } = {},
  ) {
    const issuances = options.issuances ?? [issuanceRequest()];
    const transfers = (options.transfers ?? []).map((t) => ({ heldAt: null, ...t }));
    const revocations = (options.revocations ?? []).map((r) => ({ heldAt: null, ...r }));
    const properties = options.properties ?? [importedPlot()];

    const draft = {
      id: 30,
      status: 'DRAFT',
      newRoot: '555',
      txHash: null,
      createdAt,
      issuances,
      transfers,
      revocations,
    };
    const prisma = {
      issuanceRequest: {
        findMany: jest.fn().mockResolvedValue(issuances),
        update: statement('issuanceRequest.update'),
      },
      transferRequest: {
        findMany: jest.fn().mockResolvedValue(transfers),
        update: statement('transferRequest.update'),
      },
      revocation: {
        findMany: jest.fn().mockResolvedValue(revocations),
        update: statement('revocation.update'),
        count: jest.fn().mockResolvedValue(0),
      },
      property: {
        findMany: jest.fn().mockResolvedValue(properties),
        update: statement('property.update'),
      },
      changeSetArchive: { create: statement('changeSetArchive.create') },
      landOffice: { findMany: jest.fn().mockResolvedValue(OFFICES) },
      changeSet: {
        create: jest.fn(async ({ data }: { data: { newRoot: string } }) => ({
          id: 30,
          newRoot: data.newRoot,
          status: 'DRAFT',
          createdAt,
        })),
        findUnique: jest.fn().mockResolvedValue(draft),
        update: statement('changeSet.update'),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const chain = {
      getLatestRoot: jest.fn().mockResolvedValue(555n),
      invalidateRootCache: jest.fn(),
      getRootVersion: jest.fn().mockResolvedValue(12),
      rootRegistryAddress: '0xregistry',
      explorerTxUrlPrefix: undefined,
    };
    const nodes = {
      projectRoot: jest.fn().mockResolvedValue(overlayOf(555n)),
      applyStatements: jest.fn().mockReturnValue([]),
      proofInOverlay: jest
        .fn()
        .mockResolvedValue({ leaf: 1n, siblings: [], pathIndices: [], root: 555n }),
    };
    const issuance = {
      // The fixture's secret 77 opens commitment 888; anything else opens nothing.
      commitmentFor: jest.fn(async (secret: bigint) => (secret === 77n ? 888n : -1n)),
    };
    const roundArchives = {
      build: jest
        .fn()
        .mockResolvedValue([
          { officeId: 9, officeCode: 'CN01', zip: Buffer.from('PK-round'), propertyCount: 1 },
        ]),
    };
    const events = {
      issuedStatements: jest.fn().mockReturnValue([]),
      transferredStatements: jest.fn().mockReturnValue([]),
      revokedStatements: jest.fn().mockReturnValue([]),
    };
    // Real LineageService so the 409 body comes from assertPredecessorsRevoked itself.
    const lineage = new LineageService({} as never);
    jest.spyOn(lineage, 'unrevokedPredecessors').mockResolvedValue(options.unrevoked ?? new Map());

    const service = new ChangeSetService(
      prisma as never,
      nodes as never,
      chain as never,
      { recordRootStatement: jest.fn().mockReturnValue('RECORD_ROOT_STMT') } as never,
      { assertNoOpenDraft: jest.fn() } as never,
      events as never,
      issuance as never,
      roundArchives as never,
      lineage as never,
    );
    return { service, prisma, chain, nodes, issuance, roundArchives, events, lineage };
  }

  const expectedLeaf = async (property = importedPlot(), ownerCommitment = '888') =>
    hashRecord(toLURRecord({ ...property, ownerCommitment }));

  describe('createDraft', () => {
    it('connects the issuance requests, stamps the creating office and writes nothing else', async () => {
      const { service, prisma } = scenario();

      const draft = await service.createDraft({ ...CENTRAL_ACTOR, officeId: 3 });

      expect(prisma.changeSet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'DRAFT',
          createdByOfficeId: 3,
          issuances: { connect: [{ id: 21 }] },
        }),
      });
      expect(draft.issuanceRequestIds).toEqual([21]);
      // D43: only confirm() may write Property or a request's status.
      expect(prisma.property.update).not.toHaveBeenCalled();
      expect(prisma.issuanceRequest.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("projects the issued leaf from the plot with the request's commitment", async () => {
      const { service, nodes } = scenario();

      await service.createDraft(CENTRAL_ACTOR);

      const updates = nodes.projectRoot.mock.calls[0][0] as Map<number, bigint | null>;
      expect(updates.get(6006)).toBe(await expectedLeaf());
    });

    it('refuses an issuance on a plot that is no longer IMPORTED, naming it (422)', async () => {
      const { service, prisma } = scenario({
        properties: [importedPlot('6006', { status: 'ISSUED' })],
      });

      const attempt = service.createDraft(CENTRAL_ACTOR);
      await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(attempt).rejects.toThrow(/6006/);
      expect(prisma.changeSet.create).not.toHaveBeenCalled();
    });

    it('refuses two READY issuance requests for one plot (409)', async () => {
      const { service, prisma } = scenario({
        issuances: [issuanceRequest(), issuanceRequest({ id: 22, ownerCommitment: '889' })],
      });

      await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toThrow(
        /more than one issuance request/,
      );
      expect(prisma.changeSet.create).not.toHaveBeenCalled();
    });

    it('refuses a plot queued for issuance and for a transfer (409)', async () => {
      const { service } = scenario({
        transfers: [{ id: 1, propertyId: '6006', newOwnerCommitment: '999', newOwnerSecret: '43' }],
      });

      const attempt = service.createDraft(CENTRAL_ACTOR);
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/issuance request and a transfer/);
    });

    it('refuses a plot queued for issuance and for a revocation, even a deferred one (409)', async () => {
      process.env.REVOCATION_CAP = '1';
      const { service } = scenario({
        revocations: [
          { id: 2, propertyId: '2002', reasonCode: 1, detailHash: '0xaa' },
          { id: 3, propertyId: '6006', reasonCode: 1, detailHash: '0xbb' },
        ],
      });

      const attempt = service.createDraft(CENTRAL_ACTOR);
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/issuance request and a revocation/);
    });

    it('re-checks that every superseded certificate is REVOKED (D90)', async () => {
      const { service, prisma, lineage } = scenario({
        unrevoked: new Map([['6006', ['5005', '5006']]]),
      });

      const error = await service.createDraft(CENTRAL_ACTOR).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        reason: 'PredecessorNotRevoked',
        message: expect.stringContaining('6006'),
        details: { '6006': '5005,5006' },
      });
      expect(lineage.unrevokedPredecessors).toHaveBeenCalledWith(['6006']);
      expect(prisma.changeSet.create).not.toHaveBeenCalled();
    });

    it('refuses an issuance request that carries no owner secret, naming it (409)', async () => {
      const { service, prisma } = scenario({ issuances: [issuanceRequest({ ownerSecret: null })] });

      const attempt = service.createDraft(CENTRAL_ACTOR);
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/#21/);
      expect(prisma.changeSet.create).not.toHaveBeenCalled();
    });

    it('refuses a request whose secret does not open its commitment (409)', async () => {
      const { service, prisma } = scenario({
        issuances: [issuanceRequest({ ownerCommitment: '999' })],
      });

      const attempt = service.createDraft(CENTRAL_ACTOR);
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow(/#21.*does not open/);
      expect(prisma.changeSet.create).not.toHaveBeenCalled();
    });

    it('a held issuance request still blocks a second request for its plot', async () => {
      const { service, prisma } = scenario({
        issuances: [
          issuanceRequest({ heldAt: new Date() }),
          issuanceRequest({ id: 22, ownerCommitment: '889' }),
        ],
      });

      await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toThrow(
        /more than one issuance request/,
      );
      expect(prisma.changeSet.create).not.toHaveBeenCalled();
    });

    it('draftDetail lists the connected issuance requests', async () => {
      const { service } = scenario();

      await expect(service.draftDetail(30)).resolves.toMatchObject({
        id: 30,
        issuanceRequestIds: [21],
        transferIds: [],
        revocationIds: [],
      });
    });
  });

  describe('confirm', () => {
    it('issues the plot: ISSUED with its commitment, leaf, root version and issue time', async () => {
      const { service, prisma } = scenario();

      await service.confirm(30, undefined, CENTRAL_ACTOR);

      expect(prisma.property.update).toHaveBeenCalledWith({
        where: { propertyId: '6006' },
        data: {
          status: 'ISSUED',
          ownerCommitment: '888',
          leaf: (await expectedLeaf()).toString(),
          rootVersion: 12,
          issuedAt: expect.any(Date),
        },
      });
    });

    it('clears ownerSecret in the same $transaction that writes the archives (D87, D88)', async () => {
      const { service, prisma } = scenario();

      await service.confirm(30, undefined, { ...CENTRAL_ACTOR, officeId: 2 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const statements = prisma.$transaction.mock.calls[0][0] as { label: string; args: any }[];
      expect(statements).toContainEqual({
        label: 'issuanceRequest.update',
        args: {
          where: { id: 21 },
          data: { status: 'PUBLISHED', publishedAt: expect.any(Date), ownerSecret: null },
        },
      });
      expect(statements).toContainEqual({
        label: 'changeSet.update',
        args: {
          where: { id: 30 },
          data: expect.objectContaining({
            status: 'PUBLISHED',
            confirmedByOfficeId: 2,
          }),
        },
      });
      expect(statements).toContainEqual({
        label: 'changeSetArchive.create',
        args: {
          data: {
            changeSetId: 30,
            officeId: 9,
            zip: Buffer.from('PK-round'),
            propertyCount: 1,
            expiresAt: expect.any(Date),
          },
        },
      });
      // Archive rows come before the change set closes, all in the one array.
      const labels = statements.map((st) => st.label);
      expect(labels.indexOf('changeSetArchive.create')).toBeLessThan(
        labels.indexOf('changeSet.update'),
      );
    });

    it('records an ISSUED event with the new commitment and leaf', async () => {
      const { service, events } = scenario();

      await service.confirm(30, '0xabc', CENTRAL_ACTOR);

      expect(events.issuedStatements).toHaveBeenCalledWith(
        [{ propertyId: '6006', ownerCommitment: '888', leaf: (await expectedLeaf()).toString() }],
        { rootVersion: 12, txHash: '0xabc' },
      );
    });

    it('passes the issued request, the new leaf and the projected tree to the archive builder', async () => {
      const { service, roundArchives } = scenario();

      await service.confirm(30, undefined, CENTRAL_ACTOR);

      const input = roundArchives.build.mock.calls[0][0];
      expect(input).toMatchObject({
        changeSetId: 30,
        rootVersion: 12,
        overlay: expect.objectContaining({ root: 555n }),
        issuances: [expect.objectContaining({ propertyId: '6006', ownerSecret: '77' })],
        transfers: [],
      });
      expect(input.newLeaves.get('6006')).toBe((await expectedLeaf()).toString());
    });

    it('hands issued and transferred plots to the builder together, and clears both secrets in the one $transaction', async () => {
      const { service, roundArchives, prisma } = scenario({
        transfers: [{ id: 1, propertyId: '1001', newOwnerCommitment: '999', newOwnerSecret: '43' }],
        properties: [importedPlot(), propertyRow({ propertyId: '1001', ownerCommitment: 'old' })],
      });

      await service.confirm(30, undefined, CENTRAL_ACTOR);

      expect(roundArchives.build).toHaveBeenCalledTimes(1);
      const input = roundArchives.build.mock.calls[0][0];
      expect(input.issuances.map((r: { propertyId: string }) => r.propertyId)).toEqual(['6006']);
      expect(input.transfers.map((t: { propertyId: string }) => t.propertyId)).toEqual(['1001']);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const statements = prisma.$transaction.mock.calls[0][0] as { label: string; args: unknown }[];
      expect(statements).toContainEqual({
        label: 'transferRequest.update',
        args: {
          where: { id: 1 },
          data: expect.objectContaining({ status: 'PUBLISHED', newOwnerSecret: null }),
        },
      });
      expect(statements).toContainEqual({
        label: 'issuanceRequest.update',
        args: { where: { id: 21 }, data: expect.objectContaining({ ownerSecret: null }) },
      });
      expect(statements.map((st) => st.label)).toContain('changeSetArchive.create');
    });

    it('refuses a plot that stopped being IMPORTED after the draft (422)', async () => {
      const { service, prisma } = scenario({
        properties: [importedPlot('6006', { status: 'ISSUED' })],
      });

      const attempt = service.confirm(30, undefined, CENTRAL_ACTOR);
      await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(attempt).rejects.toThrow(/6006/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an issuance request without a secret, before touching the chain', async () => {
      const { service, prisma, chain } = scenario({
        issuances: [issuanceRequest({ ownerSecret: null })],
      });

      await expect(service.confirm(30, undefined, CENTRAL_ACTOR)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(chain.getLatestRoot).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a request whose secret does not open its commitment, before the chain read', async () => {
      const { service, prisma, chain } = scenario({
        issuances: [issuanceRequest({ ownerCommitment: '999' })],
      });

      const attempt = service.confirm(30, undefined, CENTRAL_ACTOR);
      await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(attempt).rejects.toThrow(/#21.*does not open/);
      expect(chain.getLatestRoot).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns the published issuance request ids', async () => {
      const { service } = scenario();

      await expect(service.confirm(30, undefined, CENTRAL_ACTOR)).resolves.toMatchObject({
        id: 30,
        rootVersion: 12,
        issuanceRequestIds: [21],
      });
    });
  });
});

describe('ChangeSetService — buyer secrets and the archive (D77)', () => {
  it('createDraft refuses transfers submitted before D77 and names them', async () => {
    const prisma = {
      issuanceRequest: { findMany: jest.fn().mockResolvedValue([]) },
      transferRequest: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 5, propertyId: '7', newOwnerCommitment: '1', newOwnerSecret: null, heldAt: null },
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
      {} as never,
    );

    await expect(service.createDraft(CENTRAL_ACTOR)).rejects.toThrow(/#5/);
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
        archives: [
          { firstDownloadedAt: new Date() },
          { firstDownloadedAt: null },
          { firstDownloadedAt: null },
        ],
        _count: { issuances: 5, transfers: 2, revocations: 1 },
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
      {} as never,
    );

    const [row] = await service.list();

    expect(row).toMatchObject({
      id: 3,
      issuanceCount: 5,
      transferCount: 2,
      revocationCount: 1,
      archiveCount: 3,
      archivesDownloaded: 1,
    });
    expect(row).not.toHaveProperty('_count');
    expect(row).not.toHaveProperty('archives');
    const select = findMany.mock.calls[0][0].select;
    // Only the download stamp of each archive is read, never its bytes.
    expect(select.archives).toEqual({ select: { firstDownloadedAt: true } });
  });
});
