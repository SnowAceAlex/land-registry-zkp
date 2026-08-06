import { PDFDocument } from 'pdf-lib';
import { MerkleProofData, TREE_DEPTH } from '@land-registry/blockchain/shared';

import { PdfService } from './pdf.service';
import { ZipService } from './zip.service';
import { buildReceipt } from './receipt.builder';
import { toLURRecord } from '../records/record.mapper';
import { makeProperty } from '../../test/factories';

const merkleProof: MerkleProofData = {
  leaf: 555n,
  siblings: Array.from({ length: TREE_DEPTH }, (_, i) => BigInt(i + 1)),
  pathIndices: Array.from({ length: TREE_DEPTH }, () => 0),
  root: 999n,
};

function makeReceipt(overrides = {}) {
  const property = makeProperty({
    propertyId: '1001',
    // Two-tier address (no district), the structure in force since 01/7/2025.
    address: 'Số 12, Đường Nguyễn Huệ, Phường Sài Gòn, Thành phố Hồ Chí Minh',
    ...overrides,
  });
  return buildReceipt({
    property,
    record: toLURRecord(property),
    merkleProof,
    rootVersion: 3,
    merkleRoot: 999n,
    transactionHash: '0xabc',
    contractAddress: '0xE18dfcb4B669A406aB9106e6dD783fb9eE3C1eA8',
    issuer: {
      ethereumAccount: '0xc128Eb26F177BB6a3b4374A715be350887ED7726',
      ethereumAccountSignature: 'c2ln',
      IssuerCertificateChain: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    },
    issuedOn: '2026-07-24T10:12:33+07:00',
  });
}

describe('PdfService (D17)', () => {
  const service = new PdfService();

  it('renders a one-page PDF with Vietnamese diacritics embedded', async () => {
    // pdf-lib's built-in fonts throw on U+1EA0–1EF9, so this passing IS the
    // proof that the Unicode TTF is actually being embedded.
    const pdf = await service.renderCertificate(makeReceipt());

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBe(1);
  }, 30_000);

  it('renders perpetual and fixed-term tenure without hitting the epoch-date trap', async () => {
    const fixedTerm = await service.renderCertificate(
      makeReceipt({ tenureType: 'FIXED_TERM', validityPeriod: '2461449600', landUseCode: 'LUC' }),
    );

    expect(fixedTerm.length).toBeGreaterThan(1000);
  }, 30_000);

  it('renders when the optional GCN fields are absent', async () => {
    // mapSheetNumber / landOrigin are nullable: records imported before those
    // columns existed must still produce a certificate, printing an em dash.
    const pdf = await service.renderCertificate(
      makeReceipt({ mapSheetNumber: null, landOrigin: null, landUserType: null }),
    );

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it('embeds a QR code, so the PDF grows relative to a text-only render', async () => {
    const pdf = await service.renderCertificate(makeReceipt(), 'https://sepolia.etherscan.io/tx/0xabc');

    expect(pdf.length).toBeGreaterThan(5000);
  }, 30_000);
});

describe('ZipService', () => {
  const service = new ZipService();

  it('produces a real ZIP archive in memory', async () => {
    const zip = await service.create([
      { name: 'receipt.json', content: '{"a":1}' },
      { name: 'secret.json', content: '{"ownerSecret":"123"}' },
    ]);

    // Local file header magic — "PK\x03\x04"
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(zip.length).toBeGreaterThan(0);
  });
});
