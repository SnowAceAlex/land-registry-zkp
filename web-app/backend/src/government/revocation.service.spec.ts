import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { keccak256, toUtf8Bytes } from 'ethers';

import { RevocationService } from './revocation.service';
import { BRANCH_ACTOR, CENTRAL_ACTOR } from '../../test/factories';

describe('RevocationService (D45)', () => {
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const create = jest.fn();
  const findMany = jest.fn();
  const transferFindFirst = jest.fn();
  const prisma = {
    property: { findUnique },
    revocation: { findFirst, create, findMany },
    transferRequest: { findFirst: transferFindFirst },
  } as never;
  const service = new RevocationService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({
      propertyId: '1001',
      status: 'ISSUED',
      ownerCommitment: '111',
      landOfficeId: BRANCH_ACTOR.officeId,
    });
    findMany.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);
    transferFindFirst.mockResolvedValue(null);
    create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
  });

  it('hashes the detail text with keccak256 — that hash is what goes on chain', async () => {
    const result = await service.request(
      {
        propertyId: '1001',
        reasonCode: 3,
        detailText: 'tranh chấp thừa kế',
      },
      CENTRAL_ACTOR,
    );

    expect(result.detailHash).toBe(keccak256(toUtf8Bytes('tranh chấp thừa kế')));
  });

  it('rejects a reason code outside 1..5, matching the contract', async () => {
    await expect(
      service.request({ propertyId: '1001', reasonCode: 0, detailText: 'x' }, CENTRAL_ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.request({ propertyId: '1001', reasonCode: 6, detailText: 'x' }, CENTRAL_ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a property that is not currently ISSUED', async () => {
    findUnique.mockResolvedValue({ propertyId: '1001', status: 'IMPORTED' });
    await expect(
      service.request({ propertyId: '1001', reasonCode: 1, detailText: 'x' }, CENTRAL_ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an unknown property', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      service.request({ propertyId: '9999', reasonCode: 1, detailText: 'x' }, CENTRAL_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a second pending request for the same property', async () => {
    findFirst.mockResolvedValue({ id: 5 });
    await expect(
      service.request({ propertyId: '1001', reasonCode: 1, detailText: 'x' }, CENTRAL_ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a plot with an open transfer — one open procedure per plot', async () => {
    transferFindFirst.mockResolvedValue({ id: 4, status: 'APPROVED' });

    await expect(
      service.request({ propertyId: '1001', reasonCode: 1, detailText: 'x' }, CENTRAL_ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  describe('area scope and office stamps (D83, D86)', () => {
    const OTHER_BRANCH = { ...BRANCH_ACTOR, officeId: 10, officeCode: 'CN02' };
    const dto = { propertyId: '1001', reasonCode: 1, detailText: 'x' };

    it('another branch gets 403 and nothing is written', async () => {
      await expect(service.request(dto, OTHER_BRANCH)).rejects.toMatchObject({
        response: { reason: 'OutsideOfficeArea' },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('checks the scope before the plot state, so another branch learns nothing', async () => {
      findUnique.mockResolvedValue({
        propertyId: '1001',
        status: 'IMPORTED',
        landOfficeId: BRANCH_ACTOR.officeId,
      });

      await expect(service.request(dto, OTHER_BRANCH)).rejects.toMatchObject({ status: 403 });
    });

    it('the own branch stamps officeId and landOfficeId', async () => {
      await service.request(dto, BRANCH_ACTOR);

      const data = create.mock.calls[0][0].data;
      expect(data.officeId).toBe(BRANCH_ACTOR.officeId);
      expect(data.landOfficeId).toBe(BRANCH_ACTOR.officeId);
    });

    it('a central office passes on any plot and stamps its own id with the plot’s office', async () => {
      await service.request(dto, CENTRAL_ACTOR);

      const data = create.mock.calls[0][0].data;
      expect(data.officeId).toBe(CENTRAL_ACTOR.officeId);
      expect(data.landOfficeId).toBe(BRANCH_ACTOR.officeId);
    });

    it('pending: a branch sees its own area, a central office everything', async () => {
      await service.pending(BRANCH_ACTOR);
      expect(findMany.mock.calls[0][0].where).toEqual({
        status: 'PENDING',
        landOfficeId: BRANCH_ACTOR.officeId,
      });

      await service.pending(CENTRAL_ACTOR);
      expect(findMany.mock.calls[1][0].where).toEqual({ status: 'PENDING' });
    });
  });
});
