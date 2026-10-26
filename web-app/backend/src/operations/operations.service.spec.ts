import { Logger, ServiceUnavailableException } from '@nestjs/common';

import { BRANCH_ACTOR, CENTRAL_ACTOR } from '../../test/factories';
import { DEFAULT_REVOCATION_CAP } from '../government/changeset.service';
import { OperationsService } from './operations.service';

const now = new Date('2026-10-15T12:00:00Z');
const HOUR = 3_600_000;
const BRANCH_ID = BRANCH_ACTOR.officeId; // CN01
const OTHER_ID = 10; // CN02

const OFFICES = [
  { id: 1, code: 'HQ', name: 'Head office', kind: 'HEAD_OFFICE' },
  { id: BRANCH_ID, code: 'CN01', name: 'Branch 1', kind: 'BRANCH' },
  { id: OTHER_ID, code: 'CN02', name: 'Branch 2', kind: 'BRANCH' },
];

type Group = { landOfficeId: number | null; officeId?: number; _count: number; _min?: object };
const open = (landOfficeId: number | null, count: number, hoursOld = 1): Group => ({
  landOfficeId,
  _count: count,
  _min: { createdAt: new Date(now.getTime() - hoursOld * HOUR) },
});

interface TableData {
  open?: Group[];
  held?: Group[];
  stale?: Group[];
  pending?: Group[];
  fallback?: Group[];
}

// groupBy answers by the shape of the question, as the service asks it.
function table(data: TableData) {
  return {
    groupBy: jest.fn(async (args: any) => {
      if (args.by.length === 2) return data.fallback ?? [];
      if (args.where.heldAt) return data.held ?? [];
      if (args.where.createdAt) return data.stale ?? [];
      if (args.where.status === 'PENDING') return data.pending ?? [];
      return data.open ?? [];
    }),
  };
}

interface Setup {
  issuance?: TableData;
  transfer?: TableData;
  revocation?: TableData;
  dbRoot?: { root: string; version: number; txHash: string; publishedAt: Date } | null;
  chainRoot?: { root: bigint; version: number };
  chainFails?: boolean;
  roleFails?: boolean;
  authorityRole?: boolean;
  attesterRole?: boolean;
  draft?: { kind: 'changeset'; id: number } | null;
  archives?: { changeSetId: number; officeId: number }[];
  unassigned?: number;
}

function build(o: Setup = {}) {
  const prisma = {
    landOffice: { findMany: jest.fn().mockResolvedValue(OFFICES) },
    issuanceRequest: table(o.issuance ?? {}),
    transferRequest: table(o.transfer ?? {}),
    revocation: table(o.revocation ?? {}),
    merkleRoot: { findFirst: jest.fn().mockResolvedValue(o.dbRoot ?? null) },
    changeSet: {
      findUnique: jest.fn().mockResolvedValue({ newRoot: '555', createdAt: now }),
    },
    // Both archive windows are asked with findMany; the spec tells them apart by `where`.
    changeSetArchive: {
      findMany: jest.fn(async (args: any) => (args.where.zip ? (o.archives ?? []) : [])),
    },
    property: { count: jest.fn().mockResolvedValue(o.unassigned ?? 0) },
  };
  const down = () => jest.fn().mockRejectedValue(new ServiceUnavailableException('rpc down'));
  const chain = {
    network: 'localhost',
    chainId: 31337,
    authorityAddress: '0xAuthority',
    getRoot: o.chainFails
      ? down()
      : jest.fn().mockResolvedValue(o.chainRoot ?? { root: 77n, version: 4 }),
    hasAuthorityRole: o.roleFails ? down() : jest.fn().mockResolvedValue(o.authorityRole ?? true),
    hasAttesterRole: o.roleFails ? down() : jest.fn().mockResolvedValue(o.attesterRole ?? true),
  };
  const attestation = { address: '0xAttester' };
  const draftLock = { openDraft: jest.fn().mockResolvedValue(o.draft ?? null) };
  const service = new OperationsService(
    prisma as never,
    chain as never,
    attestation as never,
    draftLock as never,
  );
  return { prisma, chain, service };
}

const synced = { root: '77', version: 4, txHash: '0xabc', publishedAt: new Date('2026-10-13') };

afterEach(() => {
  delete process.env.REVOCATION_CAP;
  delete process.env.QUEUE_STALE_DAYS;
});

describe('OperationsService.offices (D89)', () => {
  it('returns one row per office plus the unassigned row, counted by plot area', async () => {
    const { service } = build({
      issuance: { open: [open(BRANCH_ID, 41, 50), open(null, 2)] },
      transfer: {
        open: [open(BRANCH_ID, 187, 10), open(OTHER_ID, 3, 5)],
        fallback: [
          { landOfficeId: BRANCH_ID, officeId: 1, _count: 4 },
          { landOfficeId: BRANCH_ID, officeId: BRANCH_ID, _count: 183 },
        ],
      },
      revocation: {
        open: [open(BRANCH_ID, 55, 30)],
        held: [open(BRANCH_ID, 1)],
        fallback: [{ landOfficeId: BRANCH_ID, officeId: 1, _count: 2 }],
      },
    });
    const rows = await service.offices(now);

    expect(rows.map((r) => r.officeCode)).toEqual(['HQ', 'CN01', 'CN02', null]);
    expect(rows[1]).toEqual({
      officeCode: 'CN01',
      officeName: 'Branch 1',
      kind: 'BRANCH',
      issuance: 41,
      transfer: 187,
      revocation: 55,
      held: 1,
      fallback: 6,
      oldestAgeHours: 50,
    });
    expect(rows[2]).toMatchObject({ transfer: 3, issuance: 0, oldestAgeHours: 5 });
    expect(rows[0]).toMatchObject({ issuance: 0, oldestAgeHours: null });
    expect(rows[3]).toEqual({
      officeCode: null,
      officeName: null,
      kind: null,
      issuance: 2,
      transfer: 0,
      revocation: 0,
      held: 0,
      fallback: 0,
      oldestAgeHours: 1,
    });
  });

  it('never loads procedure rows', async () => {
    const { prisma, service } = build();
    await service.offices(now);
    for (const t of [prisma.issuanceRequest, prisma.transferRequest, prisma.revocation]) {
      expect(Object.keys(t)).toEqual(['groupBy']);
    }
  });
});

describe('OperationsService.overview (D89)', () => {
  it('reports the registry, queue totals and no alerts when everything is in sync', async () => {
    const { service } = build({
      dbRoot: synced,
      issuance: { open: [open(BRANCH_ID, 2)] },
      transfer: { open: [open(OTHER_ID, 5)] },
      revocation: { open: [open(null, 3)], held: [open(null, 1)] },
    });
    const dto = await service.overview(CENTRAL_ACTOR, now);

    expect(dto.registry).toEqual({
      network: 'localhost',
      chainId: 31337,
      onChainVersion: 4,
      onChainRoot: '77',
      dbVersion: 4,
      lastPublishedAt: synced.publishedAt,
      lastTxHash: '0xabc',
      inSync: true,
    });
    expect(dto.queue).toEqual({ issuance: 2, transfer: 5, revocation: 3, held: 1 });
    expect(dto.openDraft).toBeNull();
    expect(dto.revocationCap).toBe(DEFAULT_REVOCATION_CAP);
    expect(dto.roundsNeeded).toBe(1);
    expect(dto.alerts).toEqual([{ code: 'HeldItems', severity: 'info', count: 1 }]);
  });

  it('describes the open draft from its change set', async () => {
    const { service } = build({ dbRoot: synced, draft: { kind: 'changeset', id: 9 } });
    const dto = await service.overview(CENTRAL_ACTOR, now);
    expect(dto.openDraft).toEqual({ id: 9, newRoot: '555', createdAt: now });
  });

  it('raises ChainAheadOfDatabase and marks the registry out of sync', async () => {
    const { service } = build({ dbRoot: { ...synced, root: '70', version: 3 } });
    const dto = await service.overview(CENTRAL_ACTOR, now);
    expect(dto.registry.inSync).toBe(false);
    expect(dto.alerts[0]).toEqual({ code: 'ChainAheadOfDatabase', severity: 'error' });
  });

  it('treats an empty database at chain version 0 as in sync', async () => {
    const { service } = build({ chainRoot: { root: 0n, version: 0 }, dbRoot: null });
    const dto = await service.overview(CENTRAL_ACTOR, now);
    expect(dto.registry).toMatchObject({ dbVersion: null, lastTxHash: null, inSync: true });
    expect(dto.alerts).toEqual([]);
  });

  it('scopes the queue totals of a branch to its own area and keeps only its alerts', async () => {
    const { service } = build({
      dbRoot: synced,
      issuance: { open: [open(BRANCH_ID, 2), open(OTHER_ID, 9)] },
      transfer: {
        open: [open(BRANCH_ID, 4), open(OTHER_ID, 6)],
        pending: [
          { landOfficeId: BRANCH_ID, _count: 1 },
          { landOfficeId: OTHER_ID, _count: 6 },
        ],
      },
      revocation: { open: [open(OTHER_ID, 7)], held: [open(OTHER_ID, 2)] },
      unassigned: 12,
    });
    const dto = await service.overview(BRANCH_ACTOR, now);

    expect(dto.queue).toEqual({ issuance: 2, transfer: 4, revocation: 0, held: 0 });
    expect(dto.alerts).toEqual([
      { code: 'PendingTransfersWouldBreak', severity: 'warning', count: 1, officeCode: 'CN01' },
    ]);
  });

  it('flags a backlog over REVOCATION_CAP, ignoring held revocations', async () => {
    process.env.REVOCATION_CAP = '10';
    const { service } = build({
      dbRoot: synced,
      revocation: { open: [open(BRANCH_ID, 30), open(OTHER_ID, 5)], held: [open(OTHER_ID, 5)] },
    });
    const dto = await service.overview(CENTRAL_ACTOR, now);
    expect(dto.revocationCap).toBe(10);
    expect(dto.roundsNeeded).toBe(3);
    expect(dto.alerts).toContainEqual({
      code: 'RevocationBacklog',
      severity: 'warning',
      count: 30,
      ref: 3,
    });
  });

  it('counts stale items older than QUEUE_STALE_DAYS (default 2)', async () => {
    const { prisma, service } = build({
      dbRoot: synced,
      transfer: { stale: [{ landOfficeId: BRANCH_ID, _count: 3 }] },
      issuance: {
        stale: [
          { landOfficeId: BRANCH_ID, _count: 1 },
          { landOfficeId: null, _count: 2 },
        ],
      },
    });
    const dto = await service.overview(CENTRAL_ACTOR, now);

    const call = prisma.transferRequest.groupBy.mock.calls.find((c: any) => c[0].where.createdAt);
    expect((call![0] as any).where.createdAt.lt).toEqual(new Date(now.getTime() - 2 * 86_400_000));
    expect(dto.alerts).toEqual(
      expect.arrayContaining([
        { code: 'StaleQueueItem', severity: 'warning', count: 4, officeCode: 'CN01' },
        { code: 'StaleQueueItem', severity: 'warning', count: 2 },
      ]),
    );
  });

  it('reads QUEUE_STALE_DAYS at call time', async () => {
    process.env.QUEUE_STALE_DAYS = '5';
    const { prisma, service } = build({ dbRoot: synced });
    await service.overview(CENTRAL_ACTOR, now);
    const call = prisma.revocation.groupBy.mock.calls.find((c: any) => c[0].where.createdAt);
    expect((call![0] as any).where.createdAt.lt).toEqual(new Date(now.getTime() - 5 * 86_400_000));
  });

  it('maps archives to office codes and asks for the right windows', async () => {
    const { prisma, service } = build({
      dbRoot: synced,
      archives: [{ changeSetId: 398, officeId: OTHER_ID }],
    });
    const dto = await service.overview(CENTRAL_ACTOR, now);

    const wheres = prisma.changeSetArchive.findMany.mock.calls.map((c: any) => c[0].where);
    expect(wheres).toContainEqual({
      firstDownloadedAt: null,
      zip: { not: null },
      expiresAt: { gt: now, lte: new Date(now.getTime() + 2 * 86_400_000) },
    });
    expect(wheres).toContainEqual({ firstDownloadedAt: null, expiresAt: { lte: now } });
    expect(dto.alerts).toContainEqual({
      code: 'ArchiveNotDownloaded',
      severity: 'warning',
      officeCode: 'CN02',
      ref: 398,
    });
  });

  it('counts plots without an office, leaving revoked ones out', async () => {
    const { prisma, service } = build({ dbRoot: synced, unassigned: 6 });
    const dto = await service.overview(CENTRAL_ACTOR, now);
    expect(prisma.property.count).toHaveBeenCalledWith({
      where: { landOfficeId: null, status: { not: 'REVOKED' } },
    });
    expect(dto.alerts).toContainEqual({ code: 'UnassignedProperties', severity: 'info', count: 6 });
  });

  it('checks the authority and the attester accounts for their roles', async () => {
    const { chain, service } = build({ dbRoot: synced, authorityRole: false, attesterRole: false });
    const dto = await service.overview(CENTRAL_ACTOR, now);
    expect(chain.hasAuthorityRole).toHaveBeenCalledWith('0xAuthority');
    expect(chain.hasAttesterRole).toHaveBeenCalledWith('0xAttester');
    expect(dto.alerts.map((a) => a.code)).toEqual(['AuthorityRoleMissing', 'AttesterRoleMissing']);
  });

  it('does not throw when a role read fails: only those flags turn false, and it logs why', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = build({ dbRoot: synced, roleFails: true });
    const dto = await service.overview(CENTRAL_ACTOR, now);
    expect(dto.registry.onChainVersion).toBe(4);
    expect(dto.alerts.map((a) => a.code)).toEqual(['AuthorityRoleMissing', 'AttesterRoleMissing']);
    // A failed read is not a missing role; the log is what tells the two apart.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('rpc down'),
      expect.stringContaining('rpc down'),
    ]);
    warn.mockRestore();
  });

  it('answers 503 when the root itself cannot be read', async () => {
    const { service } = build({ chainFails: true });
    await expect(service.overview(CENTRAL_ACTOR, now)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
