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
  officeId: 9,
  approvedByOfficeId: null,
  landOfficeId: 9,
  heldAt: null,
  heldReason: null,
};

const offices = new Map([
  [1, 'HQ'],
  [9, 'CN01'],
]);

describe('toTransferRequestDto (D77)', () => {
  // The D50 lesson: what leaks is the SHAPE. Pin the exact key set, so a new
  // column stays private until someone adds it here on purpose.
  it('names exactly the public fields', () => {
    expect(Object.keys(toTransferRequestDto(row as never, offices)).sort()).toEqual(
      [
        'byFallback',
        'changeSetId',
        'createdAt',
        'decidedAt',
        'held',
        'id',
        'landOfficeCode',
        'newOwnerCommitment',
        'newRoot',
        'officeCode',
        'oldRoot',
        'propertyId',
        'rejectReason',
        'status',
        'txHash',
      ].sort(),
    );
  });

  it('never carries the buyer secret', () => {
    expect(toTransferRequestDto(row as never, offices)).not.toHaveProperty('newOwnerSecret');
  });

  it('names the filing and owning offices from the map', () => {
    const dto = toTransferRequestDto(row as never, offices);
    expect(dto.officeCode).toBe('CN01');
    expect(dto.landOfficeCode).toBe('CN01');
    expect(dto.byFallback).toBe(false);
    expect(dto.held).toBe(false);
  });

  it('flags a central office acting on another office’s plot, and a held request', () => {
    const dto = toTransferRequestDto({ ...row, officeId: 1, heldAt: new Date() } as never, offices);
    expect(dto.officeCode).toBe('HQ');
    expect(dto.landOfficeCode).toBe('CN01');
    expect(dto.byFallback).toBe(true);
    expect(dto.held).toBe(true);
  });

  it('gives null codes for an unknown office and an unassigned plot, and no fallback', () => {
    const dto = toTransferRequestDto(
      { ...row, officeId: 77, landOfficeId: null } as never,
      offices,
    );
    expect(dto.officeCode).toBeNull();
    expect(dto.landOfficeCode).toBeNull();
    expect(dto.byFallback).toBe(false);
  });
});
