import { Prisma, Property } from '@prisma/client';

/**
 * Test factories — plain in-memory Prisma-shaped rows. No DB involved; the
 * backend unit tests deliberately stay free of Postgres and of a live chain
 * (those paths are covered by the manual Phase 5 smoke flow instead).
 */
export function makeProperty(overrides: Partial<Property> = {}): Property {
  const propertyId = overrides.propertyId ?? '1';
  return {
    id: Number(propertyId),
    propertyId,
    // Distinct per property so different orderings really do give different
    // roots; a shared commitment would make some ordering bugs invisible.
    ownerCommitment: (BigInt(propertyId) * 1_000_003n + 7n).toString(),
    useType: 'RESIDENTIAL',
    validityPeriod: '0',
    encumbranceStatus: 'FREE',
    tenureType: 'PERPETUAL',
    landUseCode: 'ONT',
    landUserType: null,
    culturalPreservation: false,
    certificateSerial: `CT ${String(100000 + Number(propertyId))}`,
    bookEntryNumber: `BK-${propertyId}`,
    mapSheetNumber: '12',
    landOrigin: 'Nhà nước công nhận quyền sử dụng đất',
    // Post-2025 two-tier address: no district level (NĐ 151/2025).
    address: `Số ${propertyId}, Đường Lê Lợi, Phường Sài Gòn, TP.HCM`,
    area: new Prisma.Decimal('120.50'),
    issuingAuthority: 'Sở Nông nghiệp và Môi trường TP.HCM',
    issueDate: new Date('2026-01-15T00:00:00.000Z'),
    leaf: null,
    merkleProof: null,
    rootVersion: null,
    issuedAt: new Date('2026-01-15T00:00:00.000Z'),
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    ...overrides,
  };
}
