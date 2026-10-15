import { PropertyEvent } from '@prisma/client';

import { toPropertyEventDto } from './property-event.serializer';

describe('toPropertyEventDto', () => {
  it('returns exactly the enumerated public keys', () => {
    const row = {
      id: 7,
      propertyId: '1',
      kind: 'REVOKED',
      rootVersion: 3,
      txHash: '0xabc',
      previousOwnerCommitment: 'a',
      newOwnerCommitment: null,
      previousLeaf: 'b',
      newLeaf: null,
      detail: { reasonCode: 2, detailHash: '0xdead' },
      occurredAt: new Date('2026-10-01T00:00:00Z'),
      detailText: 'must not leak',
    } as unknown as PropertyEvent;

    const dto = toPropertyEventDto(row);

    expect(Object.keys(dto).sort()).toEqual(
      [
        'detail',
        'kind',
        'newLeaf',
        'newOwnerCommitment',
        'occurredAt',
        'previousLeaf',
        'previousOwnerCommitment',
        'rootVersion',
        'txHash',
      ].sort(),
    );
    expect(dto.detail).toEqual({ reasonCode: 2, detailHash: '0xdead' });
  });
});
