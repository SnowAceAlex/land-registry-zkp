import { serializePropertyFull, serializePropertyPublic } from './pagination';

/**
 * pagination.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression guard for the public/guarded split. `serializePropertyPublic`
 * used to be a single `serializeProperty` that spread the whole Prisma row —
 * these two tests are what would have caught that: the public projection must
 * omit every descriptive/internal field, and the guarded full projection must
 * still carry them for an authenticated officer.
 */
describe('property serializers', () => {
  const row = {
    id: 7,
    propertyId: '1',
    ownerCommitment: '123',
    status: 'ISSUED' as const,
    leaf: '456',
    rootVersion: 2,
    address: 'Số 3, Đường Nguyễn Huệ, Phường Đa Kao, Quận 1, TP.HCM',
    area: { toString: () => '266.18' } as unknown as import('@prisma/client').Prisma.Decimal,
    certificateSerial: 'AB123456',
    bookEntryNumber: 'CS01234',
    landUseCode: 'ONT',
    landUserType: null,
    culturalPreservation: false,
    mapSheetNumber: '1',
    landOrigin: 'Nhà nước công nhận quyền sử dụng đất',
    issuingAuthority: 'Sở Nông nghiệp và Môi trường TP.HCM',
    issueDate: new Date('2017-09-05T00:00:00Z'),
    useType: 'RESIDENTIAL' as const,
    validityPeriod: '0',
    encumbranceStatus: 'FREE' as const,
    tenureType: 'PERPETUAL' as const,
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    issuanceBatchId: 3,
  };

  it('serializePropertyPublic omits descriptive and internal fields', () => {
    const result = serializePropertyPublic(row);

    expect(result).toEqual({
      propertyId: '1',
      ownerCommitment: '123',
      status: 'ISSUED',
      leaf: '456',
      rootVersion: 2,
    });
    expect(result).not.toHaveProperty('address');
    expect(result).not.toHaveProperty('area');
    expect(result).not.toHaveProperty('certificateSerial');
    expect(result).not.toHaveProperty('bookEntryNumber');
    expect(result).not.toHaveProperty('landUseCode');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result).not.toHaveProperty('issuedAt');
    expect(result).not.toHaveProperty('issuanceBatchId');
  });

  it('serializePropertyFull still returns the descriptive fields for the guarded tier', () => {
    const result = serializePropertyFull(row);

    expect(result.address).toBe(row.address);
    expect(result.certificateSerial).toBe(row.certificateSerial);
    expect(result.bookEntryNumber).toBe(row.bookEntryNumber);
    expect(result.landUseCode).toBe(row.landUseCode);
    expect(result.area).toBe(266.18);
    expect(result.mapSheetNumber).toBe(row.mapSheetNumber);
    expect(result.landOrigin).toBe(row.landOrigin);
    expect(result.issuingAuthority).toBe(row.issuingAuthority);
    expect(result.issueDate).toBe(row.issueDate);
    // Even the guarded tier is explicit: internal bookkeeping stays out, so a
    // column added to the schema later cannot ride along unreviewed.
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result).not.toHaveProperty('issuanceBatchId');
    expect(result.status).toBe('ISSUED');
  });
});
