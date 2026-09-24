import { toTransferRequestDto } from './transfer-request.serializer';

/** A full row, secret included — what Prisma hands back after D77. */
const row = {
  id: 7,
  propertyId: '1001',
  newOwnerCommitment: '222',
  newOwnerSecret: '43',
  oldRoot: '5',
  newRoot: '6',
  proof: { pi_a: ['1'] },
  publicSignals: ['5', '6'],
  status: 'APPROVED',
  rejectReason: null,
  txHash: null,
  createdAt: new Date('2026-09-24T00:00:00.000Z'),
  decidedAt: null,
  changeSetId: 3,
};

describe('toTransferRequestDto (D77)', () => {
  // The D50 lesson: what leaks is the SHAPE. Pin the exact key set, so a new
  // column stays private until someone adds it here on purpose.
  it('names exactly the public fields', () => {
    expect(Object.keys(toTransferRequestDto(row as never)).sort()).toEqual(
      [
        'changeSetId',
        'createdAt',
        'decidedAt',
        'id',
        'newOwnerCommitment',
        'newRoot',
        'oldRoot',
        'propertyId',
        'rejectReason',
        'status',
        'txHash',
      ].sort(),
    );
  });

  it('never carries the buyer secret', () => {
    expect(toTransferRequestDto(row as never)).not.toHaveProperty('newOwnerSecret');
  });
});
