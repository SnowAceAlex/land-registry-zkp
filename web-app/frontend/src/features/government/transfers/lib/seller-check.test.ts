import {
  type Receipt,
  type ReceiptRecord,
  hashRecord,
  poseidonHash,
  receiptToLURRecordAsync,
} from '@land-registry/blockchain/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import type { OwnerBundle } from '@/lib/bundle';

import type { PropertyDetail } from '../../api/types';
import { checkSellerBundle } from './seller-check';

const SECRET = 424242n;

let commitment: string;
let bundle: OwnerBundle;
let property: PropertyDetail;

/** A receipt that is internally consistent: its leaf really hashes from its record. */
beforeAll(async () => {
  commitment = (await poseidonHash([SECRET])).toString();
  const record: ReceiptRecord = {
    propertyId: '1001',
    ownerCommitment: commitment,
    useType: 0,
    validityPeriod: '0',
    encumbranceStatus: 0,
    tenureType: 0,
    landUseCode: 'ONT',
    landUserType: null,
    certificateSerial: 'CT 101001',
    bookEntryNumber: 'BK-1001',
    mapSheetNumber: '12',
    landOrigin: 'Nhà nước công nhận quyền sử dụng đất',
    address: 'Số 1001, Đường Lê Lợi, Phường Sài Gòn, TP.HCM',
    area: 120.5,
    issuingAuthority: 'Sở Nông nghiệp và Môi trường TP.HCM',
    issueDate: '2026-01-15',
  };
  const leaf = await hashRecord(await receiptToLURRecordAsync(record));
  const receipt = {
    propertyId: '1001',
    leaf: leaf.toString(),
    record,
    merkleProof: { siblings: [], pathIndices: [] },
  } as unknown as Receipt;
  bundle = { receipt, secret: { propertyId: '1001', ownerSecret: SECRET.toString() } };

  property = {
    propertyId: '1001',
    landUseCode: 'ONT',
    address: record.address,
    area: 120.5,
    useType: 'RESIDENTIAL',
    tenureType: 'PERPETUAL',
    encumbranceStatus: 'FREE',
    validityPeriod: '0',
    ownerCommitment: commitment,
    rootVersion: 3,
    issuedAt: '2026-01-15T00:00:00.000Z',
    status: 'ISSUED',
    certificateSerial: record.certificateSerial,
    bookEntryNumber: record.bookEntryNumber,
    landUserType: null,
    culturalPreservation: false,
    mapSheetNumber: record.mapSheetNumber,
    landOrigin: record.landOrigin,
    issuingAuthority: record.issuingAuthority,
    issueDate: '2026-01-15T00:00:00.000Z',
  };
});

describe('checkSellerBundle (D47 counter)', () => {
  it('passes a genuine bundle of the current owner and returns the rebuilt record', async () => {
    const result = await checkSellerBundle(bundle, property);

    expect(result.issues).toEqual([]);
    expect(result.record.ownerCommitment.toString()).toBe(commitment);
    expect(result.leaf.toString()).toBe(bundle.receipt.leaf);
  });

  it('catches a receipt whose certificate fields were edited after issuance (D36)', async () => {
    const edited = {
      ...bundle,
      receipt: { ...bundle.receipt, record: { ...bundle.receipt.record, area: 1205 } },
    };

    expect((await checkSellerBundle(edited, property)).issues).toContain('leaf-mismatch');
  });

  it('catches a secret that does not open the receipt commitment', async () => {
    const wrongSecret = { ...bundle, secret: { propertyId: '1001', ownerSecret: '7' } };

    expect((await checkSellerBundle(wrongSecret, property)).issues).toEqual(['secret-mismatch']);
  });

  it('catches a receipt of a previous owner — the plot has changed hands since', async () => {
    const moved = { ...property, ownerCommitment: '999' };

    expect((await checkSellerBundle(bundle, moved)).issues).toEqual(['not-current-owner']);
  });

  it('mirrors the backend transfer guards, so no proof is spent on a refusal', async () => {
    expect((await checkSellerBundle(bundle, { ...property, status: 'REVOKED' })).issues).toEqual([
      'not-issued',
    ]);
    expect(
      (await checkSellerBundle(bundle, { ...property, encumbranceStatus: 'MORTGAGED' })).issues,
    ).toEqual(['encumbered']);
    expect((await checkSellerBundle(bundle, { ...property, landUserType: 'CDS' })).issues).toEqual([
      'community-land',
    ]);
  });
});
