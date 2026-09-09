import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { keccak256, toUtf8Bytes } from 'ethers';

import { RevocationService } from './revocation.service';

describe('RevocationService (D45)', () => {
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const create = jest.fn();
  const prisma = {
    property: { findUnique },
    revocation: { findFirst, create, findMany: jest.fn() },
  } as never;
  const service = new RevocationService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ propertyId: '1001', status: 'ISSUED' });
    findFirst.mockResolvedValue(null);
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
});
