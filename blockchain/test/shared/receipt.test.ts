/**
 * test/shared/receipt.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The browser twin of the receipt → LURRecord reconstruction (Phase 8).
 *
 * The government portal rebuilds a seller's leaf in the officer's browser before
 * proving a transfer, and the Phase 9 portal does the same for owners and
 * verifiers. `node:crypto` does not exist there, so those paths hash the
 * descriptive fields through WebCrypto instead. If the two digests ever
 * disagreed, the browser would compute a leaf that is not in the tree — which
 * surfaces as "this certificate was tampered with" about a certificate nobody
 * touched. So what is under test is that both routes produce the same number.
 */

import { expect } from 'chai';

import {
  OffchainMetadata,
  hashOffchainMetadata,
  hashOffchainMetadataAsync,
} from '../../shared/offchainMetadata';
import { ReceiptRecord, receiptToLURRecord, receiptToLURRecordAsync } from '../../shared/receipt';

const METADATA: OffchainMetadata = {
  landUseCode: 'ONT',
  landUserType: null,
  certificateSerial: 'CT 100001',
  bookEntryNumber: 'CS20001',
  mapSheetNumber: '12',
  landOrigin: 'Nhà nước công nhận quyền sử dụng đất',
  address: 'Số 3, Đường Lê Lợi, Phường Sài Gòn, TP.HCM',
  area: '266.18',
  issuingAuthority: 'Sở Nông nghiệp và Môi trường TP.HCM',
  issueDate: '2026-01-15',
};

const RECORD: ReceiptRecord = {
  propertyId: '1001',
  ownerCommitment: '19897067188519289101513059926301937407996214561223222508148918589381936293',
  useType: 0,
  validityPeriod: '0',
  encumbranceStatus: 0,
  tenureType: 0,
  landUseCode: METADATA.landUseCode,
  landUserType: METADATA.landUserType,
  certificateSerial: METADATA.certificateSerial,
  bookEntryNumber: METADATA.bookEntryNumber,
  mapSheetNumber: METADATA.mapSheetNumber,
  landOrigin: METADATA.landOrigin,
  address: METADATA.address,
  area: 266.18,
  issuingAuthority: METADATA.issuingAuthority,
  issueDate: METADATA.issueDate,
};

describe('offchainMetadata — WebCrypto twin agrees with node:crypto (Phase 8)', () => {
  it('hashes Vietnamese descriptive fields to the same field element', async () => {
    expect(await hashOffchainMetadataAsync(METADATA)).to.equal(hashOffchainMetadata(METADATA));
  });

  it('agrees on decomposed (NFD) input, which both normalise to NFC', async () => {
    const decomposed = { ...METADATA, address: METADATA.address.normalize('NFD') };

    expect(await hashOffchainMetadataAsync(decomposed)).to.equal(hashOffchainMetadata(decomposed));
    expect(hashOffchainMetadata(decomposed)).to.equal(hashOffchainMetadata(METADATA));
  });

  it('keeps null and the empty string distinct on both routes', async () => {
    const absent = { ...METADATA, mapSheetNumber: null };
    const blank = { ...METADATA, mapSheetNumber: '' };

    expect(hashOffchainMetadata(absent)).to.not.equal(hashOffchainMetadata(blank));
    expect(await hashOffchainMetadataAsync(absent)).to.equal(hashOffchainMetadata(absent));
    expect(await hashOffchainMetadataAsync(blank)).to.equal(hashOffchainMetadata(blank));
  });
});

describe('receiptToLURRecordAsync (Phase 8)', () => {
  it('rebuilds exactly the record the synchronous reader rebuilds', async () => {
    expect(await receiptToLURRecordAsync(RECORD)).to.deep.equal(receiptToLURRecord(RECORD));
  });

  it('applies the area number → 2dp bridge, so 266.1 and 266.10 are one record', async () => {
    const shortArea = { ...RECORD, area: 266.1 };
    const paddedArea = { ...METADATA, area: '266.10' };

    const record = await receiptToLURRecordAsync(shortArea);

    expect(record.offchainHash).to.equal(hashOffchainMetadata(paddedArea));
  });
});
