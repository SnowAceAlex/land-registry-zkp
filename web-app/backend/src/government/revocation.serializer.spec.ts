import { toRevocationDto } from './revocation.serializer';

const row = {
  id: 4,
  propertyId: '2002',
  reasonCode: 3,
  detailText: 'tranh chấp thừa kế',
  detailHash: '0xabc',
  status: 'PENDING',
  changeSetId: null,
  officeId: 9,
  landOfficeId: 9,
  heldAt: null,
  heldReason: null,
  createdAt: new Date('2026-10-15T00:00:00.000Z'),
  publishedAt: null,
};

const offices = new Map([
  [1, 'HQ'],
  [9, 'CN01'],
]);

describe('toRevocationDto (D50)', () => {
  // Pin the key set: a new column stays private until someone adds it here.
  it('names exactly the public fields', () => {
    expect(Object.keys(toRevocationDto(row as never, offices)).sort()).toEqual(
      [
        'byFallback',
        'changeSetId',
        'createdAt',
        'detailHash',
        'detailText',
        'held',
        'heldReason',
        'id',
        'landOfficeCode',
        'officeCode',
        'propertyId',
        'publishedAt',
        'reasonCode',
        'status',
      ].sort(),
    );
  });

  it('does not copy a column the serializer does not name, nor the numeric office ids', () => {
    const dto = toRevocationDto({ ...row, internalNote: 'x' } as never, offices);
    expect(dto).not.toHaveProperty('internalNote');
    expect(dto).not.toHaveProperty('officeId');
    expect(dto).not.toHaveProperty('landOfficeId');
    expect(dto).not.toHaveProperty('heldAt');
  });

  it('names the filing and owning offices from the map', () => {
    const dto = toRevocationDto(row as never, offices);
    expect(dto.officeCode).toBe('CN01');
    expect(dto.landOfficeCode).toBe('CN01');
    expect(dto.byFallback).toBe(false);
    expect(dto.held).toBe(false);
    expect(dto.detailText).toBe('tranh chấp thừa kế');
  });

  it('flags a central office acting on another office’s plot, and a held revocation', () => {
    const dto = toRevocationDto(
      { ...row, officeId: 1, heldAt: new Date(), heldReason: 'chờ hồ sơ' } as never,
      offices,
    );
    expect(dto.officeCode).toBe('HQ');
    expect(dto.landOfficeCode).toBe('CN01');
    expect(dto.byFallback).toBe(true);
    expect(dto.held).toBe(true);
    expect(dto.heldReason).toBe('chờ hồ sơ');
  });

  it('gives null codes for an unknown office and an unassigned plot, and no fallback', () => {
    const dto = toRevocationDto({ ...row, officeId: 77, landOfficeId: null } as never, offices);
    expect(dto.officeCode).toBeNull();
    expect(dto.landOfficeCode).toBeNull();
    expect(dto.byFallback).toBe(false);
  });
});
