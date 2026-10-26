import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { QueueService } from './queue.service';
import { BRANCH_ACTOR, CENTRAL_ACTOR } from '../../test/factories';

const now = new Date('2026-10-15T12:00:00Z');
const baseRow = {
  propertyId: '1001',
  officeId: 1,
  landOfficeId: BRANCH_ACTOR.officeId,
  heldAt: null,
  heldReason: null,
  changeSetId: null,
  createdAt: new Date('2026-10-14T12:00:00Z'),
};

function build() {
  const model = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  });
  const prisma = {
    issuanceRequest: model(),
    transferRequest: model(),
    revocation: model(),
    landOffice: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, code: 'HQ' },
        { id: BRANCH_ACTOR.officeId, code: 'CN01' },
        { id: 10, code: 'CN02' },
      ]),
    },
  };
  jest.useFakeTimers().setSystemTime(now);
  return { prisma, service: new QueueService(prisma as never) };
}

afterEach(() => jest.useRealTimers());

describe('QueueService.list (D87)', () => {
  it('forces a branch onto its own office', async () => {
    const { prisma, service } = build();
    await service.list({ skip: 0, take: 50 }, BRANCH_ACTOR);
    for (const m of [prisma.issuanceRequest, prisma.transferRequest, prisma.revocation]) {
      expect(m.findMany.mock.calls[0][0].where).toMatchObject({
        landOfficeId: BRANCH_ACTOR.officeId,
      });
    }
  });

  it('answers 403 OutsideOfficeArea when a branch asks for another office', async () => {
    const { service } = build();
    const call = service.list({ officeCode: 'CN02', skip: 0, take: 50 }, BRANCH_ACTOR);
    await expect(call).rejects.toBeInstanceOf(ForbiddenException);
    await expect(call).rejects.toMatchObject({ response: { reason: 'OutsideOfficeArea' } });
  });

  it('lets a branch name its own office', async () => {
    const { service } = build();
    await expect(
      service.list({ officeCode: 'CN01', skip: 0, take: 50 }, BRANCH_ACTOR),
    ).resolves.toEqual({ total: 0, items: [] });
  });

  it('central sees everything unless it filters; an unknown office code is 400', async () => {
    const { prisma, service } = build();
    await service.list({ skip: 0, take: 50 }, CENTRAL_ACTOR);
    expect(prisma.revocation.findMany.mock.calls[0][0].where).not.toHaveProperty('landOfficeId');

    await service.list({ officeCode: 'CN02', skip: 0, take: 50 }, CENTRAL_ACTOR);
    expect(prisma.revocation.findMany.mock.calls[1][0].where).toMatchObject({ landOfficeId: 10 });

    await expect(
      service.list({ officeCode: 'ZZ', skip: 0, take: 50 }, CENTRAL_ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists open rows only, per kind', async () => {
    const { prisma, service } = build();
    await service.list({ skip: 0, take: 50 }, CENTRAL_ACTOR);
    expect(prisma.issuanceRequest.findMany.mock.calls[0][0].where.status).toBe('READY');
    expect(prisma.transferRequest.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['PENDING', 'APPROVED'],
    });
    expect(prisma.revocation.findMany.mock.calls[0][0].where.status).toBe('PENDING');
  });

  it('maps held and olderThanDays onto the query', async () => {
    const { prisma, service } = build();
    await service.list({ held: true, olderThanDays: 2, skip: 0, take: 50 }, CENTRAL_ACTOR);
    const where = prisma.issuanceRequest.findMany.mock.calls[0][0].where;
    expect(where.heldAt).toEqual({ not: null });
    expect(where.createdAt).toEqual({ lt: new Date('2026-10-13T12:00:00Z') });

    await service.list({ held: false, skip: 0, take: 50 }, CENTRAL_ACTOR);
    expect(prisma.issuanceRequest.findMany.mock.calls[1][0].where.heldAt).toBeNull();
  });

  it('with a kind, queries only that table', async () => {
    const { prisma, service } = build();
    await service.list({ kind: 'transfer', skip: 0, take: 50 }, CENTRAL_ACTOR);
    expect(prisma.transferRequest.findMany).toHaveBeenCalled();
    expect(prisma.issuanceRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.revocation.findMany).not.toHaveBeenCalled();
  });

  it('merges the kinds oldest first, paginates the merged list, sums the totals', async () => {
    const { prisma, service } = build();
    const at = (d: string) => new Date(d);
    prisma.issuanceRequest.findMany.mockResolvedValue([
      { ...baseRow, id: 1, status: 'READY', createdAt: at('2026-10-12T00:00:00Z') },
      { ...baseRow, id: 2, status: 'READY', createdAt: at('2026-10-14T00:00:00Z') },
    ]);
    prisma.transferRequest.findMany.mockResolvedValue([
      { ...baseRow, id: 3, status: 'PENDING', createdAt: at('2026-10-13T00:00:00Z') },
    ]);
    prisma.revocation.findMany.mockResolvedValue([
      { ...baseRow, id: 4, status: 'PENDING', createdAt: at('2026-10-11T00:00:00Z') },
    ]);
    prisma.issuanceRequest.count.mockResolvedValue(2);
    prisma.transferRequest.count.mockResolvedValue(1);
    prisma.revocation.count.mockResolvedValue(1);

    const page = await service.list({ skip: 1, take: 2 }, CENTRAL_ACTOR);
    expect(page.total).toBe(4);
    expect(page.items.map((i) => `${i.kind}:${i.id}`)).toEqual(['issuance:1', 'transfer:3']);
    // each table must supply enough rows to fill the merged window
    expect(prisma.revocation.findMany.mock.calls[0][0]).toMatchObject({ take: 3, skip: 0 });
  });
});

describe('QueueService hold / release (D87)', () => {
  it.each([
    ['issuance', 'issuanceRequest', 'READY'],
    ['transfer', 'transferRequest', 'APPROVED'],
    ['revocation', 'revocation', 'PENDING'],
  ] as const)('holds and releases a %s', async (kind, table, status) => {
    const { prisma, service } = build();
    const openRow = { ...baseRow, id: 5, status };
    const heldRow = { ...openRow, heldAt: now, heldReason: 'wait for court' };
    const guard = { in: kind === 'transfer' ? ['PENDING', 'APPROVED'] : [status] };
    prisma[table].findUnique
      .mockResolvedValueOnce(openRow)
      .mockResolvedValueOnce(heldRow)
      .mockResolvedValueOnce(heldRow)
      .mockResolvedValueOnce(openRow);

    const held = await service.hold(kind, 5, 'wait for court', CENTRAL_ACTOR);
    expect(prisma[table].updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: guard, changeSetId: null },
      data: { heldAt: now, heldReason: 'wait for court' },
    });
    expect(held.held).toBe(true);

    const released = await service.release(kind, 5, CENTRAL_ACTOR);
    expect(prisma[table].updateMany).toHaveBeenLastCalledWith({
      where: { id: 5, status: guard, changeSetId: null },
      data: { heldAt: null, heldReason: null },
    });
    expect(released.held).toBe(false);
  });

  it('rejects an unknown kind with 400, a missing row with 404, a closed row with 409', async () => {
    const { prisma, service } = build();
    await expect(service.hold('bogus' as never, 1, 'x', CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.issuanceRequest.findUnique.mockResolvedValue(null);
    await expect(service.hold('issuance', 1, 'x', CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.issuanceRequest.findUnique.mockResolvedValue({ ...baseRow, id: 1, status: 'PUBLISHED' });
    await expect(service.hold('issuance', 1, 'x', CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.issuanceRequest.updateMany).not.toHaveBeenCalled();
  });

  it('refuses every action on an item already in an open draft', async () => {
    const { prisma, service } = build();
    prisma.revocation.findUnique.mockResolvedValue({
      ...baseRow,
      id: 3,
      status: 'PENDING',
      changeSetId: 12,
    });
    for (const act of [
      () => service.hold('revocation', 3, 'x', CENTRAL_ACTOR),
      () => service.release('revocation', 3, CENTRAL_ACTOR),
      () => service.withdraw('revocation', 3, CENTRAL_ACTOR),
    ]) {
      await expect(act()).rejects.toMatchObject({
        response: { reason: 'ItemInOpenDraft', details: { kind: 'revocation', id: 3 } },
      });
    }
    expect(prisma.revocation.updateMany).not.toHaveBeenCalled();
  });
});

describe('QueueService.withdraw (D87)', () => {
  it('withdraws an issuance and drops its owner secret', async () => {
    const { prisma, service } = build();
    prisma.issuanceRequest.findUnique.mockResolvedValue({ ...baseRow, id: 1, status: 'READY' });
    await service.withdraw('issuance', 1, CENTRAL_ACTOR);
    expect(prisma.issuanceRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: { in: ['READY'] }, changeSetId: null },
      data: { status: 'WITHDRAWN', ownerSecret: null, heldAt: null, heldReason: null },
    });
  });

  it('withdraws an APPROVED transfer, rejecting it and dropping the buyer secret', async () => {
    const { prisma, service } = build();
    prisma.transferRequest.findUnique.mockResolvedValue({ ...baseRow, id: 2, status: 'APPROVED' });
    await service.withdraw('transfer', 2, CENTRAL_ACTOR);
    expect(prisma.transferRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 2, status: { in: ['PENDING', 'APPROVED'] }, changeSetId: null },
      data: {
        status: 'REJECTED',
        newOwnerSecret: null,
        // No English default: the portal words a reasonless rejection itself.
        rejectReason: null,
        decidedAt: now,
        heldAt: null,
        heldReason: null,
      },
    });
  });

  it('sends a PENDING transfer to /transfers/:id/reject with 409', async () => {
    const { prisma, service } = build();
    prisma.transferRequest.findUnique.mockResolvedValue({ ...baseRow, id: 2, status: 'PENDING' });
    await expect(service.withdraw('transfer', 2, CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.transferRequest.updateMany).not.toHaveBeenCalled();
  });

  it('withdraws a revocation as REJECTED', async () => {
    const { prisma, service } = build();
    prisma.revocation.findUnique.mockResolvedValue({ ...baseRow, id: 3, status: 'PENDING' });
    await service.withdraw('revocation', 3, CENTRAL_ACTOR);
    expect(prisma.revocation.updateMany).toHaveBeenCalledWith({
      where: { id: 3, status: { in: ['PENDING'] }, changeSetId: null },
      data: { status: 'REJECTED', heldAt: null, heldReason: null },
    });
  });

  it("lets the owning branch withdraw its revocation but not another area's", async () => {
    const { prisma, service } = build();
    prisma.revocation.findUnique.mockResolvedValue({ ...baseRow, id: 3, status: 'PENDING' });
    await expect(service.withdraw('revocation', 3, BRANCH_ACTOR)).resolves.toBeDefined();

    prisma.revocation.findUnique.mockResolvedValue({
      ...baseRow,
      id: 4,
      status: 'PENDING',
      landOfficeId: 10,
    });
    await expect(service.withdraw('revocation', 4, BRANCH_ACTOR)).rejects.toMatchObject({
      response: { reason: 'OutsideOfficeArea' },
    });
  });

  it('answers a branch withdrawing an issuance or transfer with 403 CentralScopeRequired', async () => {
    const { prisma, service } = build();
    prisma.issuanceRequest.findUnique.mockResolvedValue({ ...baseRow, id: 1, status: 'READY' });
    prisma.transferRequest.findUnique.mockResolvedValue({ ...baseRow, id: 2, status: 'APPROVED' });
    for (const act of [
      () => service.withdraw('issuance', 1, BRANCH_ACTOR),
      () => service.withdraw('transfer', 2, BRANCH_ACTOR),
    ]) {
      await expect(act()).rejects.toMatchObject({ response: { reason: 'CentralScopeRequired' } });
    }
    expect(prisma.issuanceRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe('QueueService — a draft takes the item between read and write', () => {
  it.each([
    ['hold', 'revocation', 'revocation'],
    ['release', 'issuance', 'issuanceRequest'],
    ['withdraw', 'transfer', 'transferRequest'],
  ] as const)(
    '%s answers 409 ItemInOpenDraft when the guarded update matches nothing',
    async (op, kind, table) => {
      const { prisma, service } = build();
      const status = kind === 'issuance' ? 'READY' : kind === 'transfer' ? 'APPROVED' : 'PENDING';
      prisma[table].findUnique
        .mockResolvedValueOnce({ ...baseRow, id: 8, status })
        .mockResolvedValueOnce({ ...baseRow, id: 8, status, changeSetId: 21 });
      prisma[table].updateMany.mockResolvedValue({ count: 0 });

      const call =
        op === 'hold'
          ? service.hold(kind, 8, 'x', CENTRAL_ACTOR)
          : op === 'release'
            ? service.release(kind, 8, CENTRAL_ACTOR)
            : service.withdraw(kind, 8, CENTRAL_ACTOR);
      await expect(call).rejects.toMatchObject({
        response: { reason: 'ItemInOpenDraft', details: { kind, id: 8 } },
      });
    },
  );

  it('answers a plain 409 when the item was closed meanwhile', async () => {
    const { prisma, service } = build();
    prisma.revocation.findUnique
      .mockResolvedValueOnce({ ...baseRow, id: 8, status: 'PENDING' })
      .mockResolvedValueOnce({ ...baseRow, id: 8, status: 'PUBLISHED' });
    prisma.revocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.withdraw('revocation', 8, CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
