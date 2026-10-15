import { ConflictException, NotFoundException } from '@nestjs/common';

import { IssuanceRequestService } from './issuance-request.service';
import { LineageService } from '../lineage/lineage.service';
import { CENTRAL_ACTOR, makeProperty } from '../../test/factories';

describe('IssuanceRequestService (D87, D90)', () => {
  const propertyFindMany = jest.fn();
  const propertyUpdate = jest.fn();
  const reqFindMany = jest.fn();
  const reqCreate = jest.fn();
  const landOfficeFindMany = jest.fn();
  const prisma = {
    property: { findMany: propertyFindMany, update: propertyUpdate },
    issuanceRequest: { findMany: reqFindMany, create: reqCreate },
    landOffice: { findMany: landOfficeFindMany },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as never;
  // Real LineageService so the 409 body comes from assertPredecessorsRevoked itself.
  const lineage = new LineageService({} as never);
  const unrevokedPredecessors = jest.spyOn(lineage, 'unrevokedPredecessors');
  let nextSecret = 10n;
  const issuance = {
    generateOwnerSecret: jest.fn(() => nextSecret++),
    commitmentFor: jest.fn(async (s: bigint) => s * 2n + 1n),
  } as never;
  const service = new IssuanceRequestService(prisma, issuance, lineage);

  const imported = (id: string, landOfficeId: number | null = null) =>
    makeProperty({ propertyId: id, status: 'IMPORTED', ownerCommitment: null, landOfficeId });

  beforeEach(() => {
    jest.clearAllMocks();
    nextSecret = 10n;
    propertyFindMany.mockResolvedValue([imported('1001', 9), imported('1002')]);
    reqFindMany.mockResolvedValue([]);
    unrevokedPredecessors.mockResolvedValue(new Map());
    landOfficeFindMany.mockResolvedValue([
      { id: 1, code: 'HQ' },
      { id: 9, code: 'CN01' },
    ]);
    reqCreate.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 1,
        status: 'READY',
        heldAt: null,
        heldReason: null,
        changeSetId: null,
        createdAt: new Date(),
        publishedAt: null,
        ...data,
      }),
    );
  });

  it('404s listing every unknown id', async () => {
    propertyFindMany.mockResolvedValue([imported('1001')]);
    const err = await service.request(['1001', '7', '8'], CENTRAL_ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toContain('7');
    expect(err.message).toContain('8');
    expect(reqCreate).not.toHaveBeenCalled();
  });

  it('409s when a plot is not IMPORTED', async () => {
    propertyFindMany.mockResolvedValue([imported('1001'), makeProperty({ propertyId: '1002' })]);
    await expect(service.request(['1001', '1002'], CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(reqCreate).not.toHaveBeenCalled();
  });

  it('409s when a plot already has a READY request', async () => {
    reqFindMany.mockResolvedValue([{ propertyId: '1002' }]);
    await expect(service.request(['1001', '1002'], CENTRAL_ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(reqFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'READY' }) }),
    );
    expect(reqCreate).not.toHaveBeenCalled();
  });

  it('409 PredecessorNotRevoked while a predecessor is still ISSUED (revocation only pending)', async () => {
    unrevokedPredecessors.mockResolvedValue(new Map([['1002', ['900', '901']]]));
    const err = await service.request(['1001', '1002'], CENTRAL_ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      reason: 'PredecessorNotRevoked',
      details: { '1002': '900,901' },
    });
    expect(reqCreate).not.toHaveBeenCalled();
  });

  it('stores a secret that opens its commitment, stamps the offices, and never touches Property', async () => {
    const out = await service.request(['1001', '1002'], CENTRAL_ACTOR);

    expect(reqCreate).toHaveBeenCalledTimes(2);
    const [first] = reqCreate.mock.calls[0];
    expect(first.data).toMatchObject({
      propertyId: '1001',
      ownerSecret: '10',
      ownerCommitment: '21',
      officeId: CENTRAL_ACTOR.officeId,
      landOfficeId: 9,
    });
    expect(BigInt(first.data.ownerCommitment)).toBe(BigInt(first.data.ownerSecret) * 2n + 1n);
    expect(propertyUpdate).not.toHaveBeenCalled();

    expect(out.map((r) => r.propertyId)).toEqual(['1001', '1002']);
    expect(out[0]).toMatchObject({ officeCode: 'HQ', landOfficeCode: 'CN01' });
    expect(out[0]).not.toHaveProperty('ownerSecret');
  });

  it('lists by status without exposing the secret', async () => {
    reqFindMany.mockResolvedValue([
      {
        id: 2,
        propertyId: '1001',
        ownerSecret: '10',
        ownerCommitment: '21',
        status: 'READY',
        officeId: 1,
        landOfficeId: null,
        heldAt: null,
        heldReason: null,
        changeSetId: null,
        createdAt: new Date(),
        publishedAt: null,
      },
    ]);
    const out = await service.list('READY', CENTRAL_ACTOR);
    expect(reqFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'READY' } }),
    );
    expect(out[0]).not.toHaveProperty('ownerSecret');
  });
});
