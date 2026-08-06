import {
  IssuerBlock,
  MerkleProofData,
  TREE_DEPTH,
  UseType,
} from '@land-registry/blockchain/shared';

import { buildReceipt, buildSecretFile } from './receipt.builder';
import { toLURRecord } from '../records/record.mapper';
import { makeProperty } from '../../test/factories';

const ISSUER: IssuerBlock = {
  ethereumAccount: '0xc128Eb26F177BB6a3b4374A715be350887ED7726',
  ethereumAccountSignature: 'c2lnbmF0dXJl',
  IssuerCertificateChain: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
};

function makeMerkleProof(overrides: Partial<MerkleProofData> = {}): MerkleProofData {
  return {
    leaf: 555n,
    siblings: Array.from({ length: TREE_DEPTH }, (_, i) => BigInt(i + 1)),
    pathIndices: Array.from({ length: TREE_DEPTH }, (_, i) => i % 2),
    root: 999n,
    ...overrides,
  };
}

function buildFixture(propertyOverrides = {}) {
  const property = makeProperty({ propertyId: '1001', ...propertyOverrides });
  return buildReceipt({
    property,
    record: toLURRecord(property),
    merkleProof: makeMerkleProof(),
    rootVersion: 7,
    merkleRoot: 999n,
    transactionHash: '0xabc123',
    contractAddress: '0xE18dfcb4B669A406aB9106e6dD783fb9eE3C1eA8',
    issuer: ISSUER,
    issuedOn: '2026-07-24T10:12:33+07:00',
  });
}

describe('receipt.json (D31 / §3.1)', () => {
  it('carries exactly the top-level fields the format specifies', () => {
    expect(Object.keys(buildFixture()).sort()).toEqual([
      'contractAddress',
      'issuedOn',
      'issuer',
      'leaf',
      'merkleProof',
      'merkleRoot',
      'propertyId',
      'record',
      'rootVersion',
      'transactionHash',
    ]);
  });

  it('keeps the [SmartCert] issuer field names, including the capital I', () => {
    const receipt = buildFixture();

    expect(receipt.issuer).toHaveProperty('IssuerCertificateChain');
    expect(receipt.issuer).toHaveProperty('ethereumAccount');
    expect(receipt.issuer).toHaveProperty('ethereumAccountSignature');
  });

  it('emits the Merkle proof at the fixed circuit depth', () => {
    const receipt = buildFixture();

    expect(receipt.merkleProof.siblings).toHaveLength(TREE_DEPTH);
    expect(receipt.merkleProof.pathIndices).toHaveLength(TREE_DEPTH);
    expect(receipt.merkleProof.siblings.every((s) => typeof s === 'string')).toBe(true);
    expect(receipt.merkleProof.pathIndices.every((i) => i === 0 || i === 1)).toBe(true);
  });

  it('rejects a proof that is not the fixed depth rather than issuing an unusable bundle', () => {
    const property = makeProperty({ propertyId: '1001' });

    expect(() =>
      buildReceipt({
        property,
        record: toLURRecord(property),
        merkleProof: makeMerkleProof({ siblings: [1n, 2n] }),
        rootVersion: 1,
        merkleRoot: 1n,
        transactionHash: '0x1',
        contractAddress: '0x2',
        issuer: ISSUER,
        issuedOn: '2026-07-24T10:12:33+07:00',
      }),
    ).toThrow(/depth-20 Merkle proof/);
  });

  it('serializes bigints as strings and enums as numbers', () => {
    const receipt = buildFixture({ useType: 'COMMERCIAL' });

    expect(receipt.merkleRoot).toBe('999');
    expect(receipt.leaf).toBe('555');
    expect(receipt.propertyId).toBe('1001');
    expect(receipt.record.useType).toBe(UseType.COMMERCIAL);
    expect(receipt.rootVersion).toBe(7);
  });

  it('includes the off-chain metadata the PDF and UI need (D3/D19)', () => {
    const receipt = buildFixture();

    expect(receipt.record).toMatchObject({
      landUseCode: 'ONT',
      certificateSerial: 'CT 101001',
      bookEntryNumber: 'BK-1001',
      issuingAuthority: 'Sở Nông nghiệp và Môi trường TP.HCM',
      area: 120.5,
    });
    expect(receipt.record.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('carries the GCN fields the certificate template prints (PDF-03)', () => {
    const receipt = buildFixture();

    // Số tờ bản đồ and Nguồn gốc sử dụng đất are mandatory on a real GCN; the
    // PDF cannot print what the receipt does not carry.
    expect(receipt.record).toMatchObject({
      mapSheetNumber: '12',
      landOrigin: 'Nhà nước công nhận quyền sử dụng đất',
    });
    // Đối tượng sử dụng đất is separate from the land code (it is not a land
    // category — see the removal of NTS_CD).
    expect(receipt.record).toHaveProperty('landUserType');
  });

  it('never leaks ownerSecret — the whole point of splitting the bundle in two', () => {
    const serialized = JSON.stringify(buildFixture());

    expect(serialized).not.toContain('ownerSecret');
    expect(serialized).toContain('ownerCommitment'); // the public commitment belongs here
  });

  it('puts the secret in its own file, keyed to the property', () => {
    expect(buildSecretFile(1001n, 12345n)).toEqual({
      propertyId: '1001',
      ownerSecret: '12345',
    });
  });
});
