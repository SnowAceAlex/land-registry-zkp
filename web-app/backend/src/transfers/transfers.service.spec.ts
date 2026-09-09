import { GoneException } from '@nestjs/common';

import { TransfersService } from './transfers.service';
import { makeProperty } from '../../test/factories';

describe('TransfersService.requireTransferableProperty (D45/D48)', () => {
  it('410s a revoked property instead of crashing deep inside generateMerkleProof', async () => {
    const revoked = makeProperty({ propertyId: '1001', status: 'REVOKED' });
    const prisma = {
      property: { findUnique: jest.fn().mockResolvedValue(revoked) },
    } as never;

    const service = new TransfersService(prisma, {} as never, {} as never);

    await expect(
      service.preview({ propertyId: '1001', newOwnerCommitment: '123' }),
    ).rejects.toMatchObject({ status: 410 });
    await expect(
      service.preview({ propertyId: '1001', newOwnerCommitment: '123' }),
    ).rejects.toBeInstanceOf(GoneException);
  });
});
