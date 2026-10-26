import { toIssuanceRequestDto } from './issuance-request.serializer';

const row = {
  id: 4,
  propertyId: '1001',
  ownerSecret: '43',
  ownerCommitment: '222',
  status: 'READY',
  officeId: 1,
  landOfficeId: 9,
  heldAt: null,
  heldReason: null,
  changeSetId: null,
  createdAt: new Date('2026-10-15T00:00:00.000Z'),
  publishedAt: null,
};
const offices = new Map([
  [1, 'HQ'],
  [9, 'CN01'],
]);

describe('toIssuanceRequestDto (D87)', () => {
  it('names exactly the public fields, never ownerSecret', () => {
    const dto = toIssuanceRequestDto(row as never, offices);
    expect(Object.keys(dto).sort()).toEqual(
      [
        'changeSetId',
        'createdAt',
        'held',
        'heldReason',
        'id',
        'landOfficeCode',
        'officeCode',
        'ownerCommitment',
        'propertyId',
        'publishedAt',
        'status',
      ].sort(),
    );
    expect(dto).not.toHaveProperty('ownerSecret');
  });

  it('resolves office codes and the held flag', () => {
    const dto = toIssuanceRequestDto(
      { ...row, heldAt: new Date(), heldReason: 'x' } as never,
      offices,
    );
    expect(dto).toMatchObject({ officeCode: 'HQ', landOfficeCode: 'CN01', held: true });
    expect(
      toIssuanceRequestDto({ ...row, landOfficeId: null } as never, offices).landOfficeCode,
    ).toBeNull();
  });
});
