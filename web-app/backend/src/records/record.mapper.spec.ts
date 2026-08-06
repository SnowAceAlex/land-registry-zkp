import {
  EncumbranceStatus,
  TenureType,
  UseType,
  hashRecord,
} from '@land-registry/blockchain/shared';

import {
  encumbranceStatusName,
  serializeLURRecord,
  tenureTypeName,
  toLURRecord,
  useTypeName,
} from './record.mapper';
import { makeProperty } from '../../test/factories';

describe('record.mapper', () => {
  it('maps enum names to the shared numeric values', () => {
    const property = makeProperty({
      useType: 'FORESTRY',
      encumbranceStatus: 'LITIGATED',
      tenureType: 'PROJECT_LEASEHOLD',
    });

    const record = toLURRecord(property);

    expect(record.useType).toBe(UseType.FORESTRY);
    expect(record.encumbranceStatus).toBe(EncumbranceStatus.LITIGATED);
    expect(record.tenureType).toBe(TenureType.PROJECT_LEASEHOLD);
  });

  it('round-trips every enum member back to its name', () => {
    expect(useTypeName(UseType.INDUSTRIAL)).toBe('INDUSTRIAL');
    expect(encumbranceStatusName(EncumbranceStatus.MORTGAGED)).toBe('MORTGAGED');
    expect(tenureTypeName(TenureType.FIXED_TERM)).toBe('FIXED_TERM');

    for (const value of [0, 1, 2, 3, 4] as UseType[]) {
      expect(useTypeName(value)).toBeDefined();
    }
  });

  it('converts the string columns to bigint', () => {
    const property = makeProperty({
      propertyId: '90071992547409931',
      ownerCommitment: '12345678901234567890',
      validityPeriod: '2461449600',
      tenureType: 'FIXED_TERM',
    });

    const record = toLURRecord(property);

    expect(record.propertyId).toBe(90071992547409931n);
    expect(record.ownerCommitment).toBe(12345678901234567890n);
    expect(record.validityPeriod).toBe(2461449600n);
  });

  it('refuses to map a property that has not been issued yet', () => {
    const property = makeProperty({ ownerCommitment: null });

    expect(() => toLURRecord(property)).toThrow(/no ownerCommitment/);
  });

  it('produces a record that hashes with the shared leaf hasher', async () => {
    const record = toLURRecord(makeProperty({ propertyId: '42' }));

    await expect(hashRecord(record)).resolves.toEqual(expect.any(BigInt));
  });

  it('serializes bigints as decimal strings and enums as numbers for receipt.json', () => {
    const record = toLURRecord(
      makeProperty({ propertyId: '7', validityPeriod: '0', useType: 'COMMERCIAL' }),
    );

    const serialized = serializeLURRecord(record);

    expect(serialized.propertyId).toBe('7');
    expect(serialized.validityPeriod).toBe('0');
    expect(serialized.useType).toBe(UseType.COMMERCIAL);
    expect(typeof serialized.ownerCommitment).toBe('string');
  });
});
