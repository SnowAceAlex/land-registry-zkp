import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { keccak256, toUtf8Bytes } from 'ethers';

import { ownerNotFrozen } from '../freeze/freeze.service';
import { RevocationService } from './revocation.service';

describe('RevocationService (D45)', () => {
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const create = jest.fn();
  const transferFindFirst = jest.fn();
  const assertFrozen = jest.fn();
  const prisma = {
    property: { findUnique },
    revocation: { findFirst, create, findMany: jest.fn() },
    transferRequest: { findFirst: transferFindFirst },
  } as never;
  const service = new RevocationService(prisma, { assertFrozen } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ propertyId: '1001', status: 'ISSUED', ownerCommitment: '111' });
    findFirst.mockResolvedValue(null);
    transferFindFirst.mockResolvedValue(null);
    assertFrozen.mockResolvedValue(undefined);
    create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
  });

  it('hashes the detail text with keccak256 — that hash is what goes on chain', async () => {
    const result = await service.request({
      propertyId: '1001',
      reasonCode: 3,
      detailText: 'tranh chấp thừa kế',
    });

    expect(result.detailHash).toBe(keccak256(toUtf8Bytes('tranh chấp thừa kế')));
  });

  it('rejects a reason code outside 1..5, matching the contract', async () => {
    await expect(
      service.request({ propertyId: '1001', reasonCode: 0, detailText: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.request({ propertyId: '1001', reasonCode: 6, detailText: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a property that is not currently ISSUED', async () => {
    findUnique.mockResolvedValue({ propertyId: '1001', status: 'IMPORTED' });
    await expect(
      service.request({ propertyId: '1001', reasonCode: 1, detailText: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an unknown property', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      service.request({ propertyId: '9999', reasonCode: 1, detailText: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a second pending request for the same property', async () => {
    findFirst.mockResolvedValue({ id: 5 });
    await expect(
      service.request({ propertyId: '1001', reasonCode: 1, detailText: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to queue a revocation whose owner is not frozen on chain (D80)', async () => {
    assertFrozen.mockRejectedValue(ownerNotFrozen(['1001']));

    await expect(
      service.request({ propertyId: '1001', reasonCode: 1, detailText: 'x' }),
    ).rejects.toMatchObject({ status: 409, response: { reason: 'OwnerNotFrozen' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('checks the freeze against the current owner commitment', async () => {
    await service.request({ propertyId: '1001', reasonCode: 1, detailText: 'x' });

    expect(assertFrozen).toHaveBeenCalledWith('1001', '111');
  });

  it('refuses a plot with an open transfer — one open procedure per plot', async () => {
    transferFindFirst.mockResolvedValue({ id: 4, status: 'APPROVED' });

    await expect(
      service.request({ propertyId: '1001', reasonCode: 1, detailText: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
});
