/**
 * features/resident/proof/lib/__fixtures__/bundle.ts — TEST FIXTURES ONLY.
 *
 * Not application code. Nothing under `components/` may import this; the
 * `__fixtures__` folder name is the signal.
 *
 * Builds a bundle that is genuine all the way down: a real depth-20 sparse
 * tree, a real Poseidon leaf, a real Merkle path. Tests that check tampering
 * then edit one field of it, so what they prove is that the check catches a
 * real difference rather than that a hand-written fixture happens to be wrong.
 */

import {
  type LURRecord,
  type Receipt,
  type ReceiptRecord,
  buildTree,
  generateMerkleProof,
  hashRecord,
  poseidonHash,
  receiptToLURRecordAsync,
} from '@land-registry/blockchain/shared';

import type { OwnerBundle } from '@/lib/bundle';

import type { MerkleProofResponse } from '../../api';

export const OWNER_SECRET = 424242n;
export const NEIGHBOUR_SECRET = 999999n;
export const PROPERTY_ID = '1001';
export const NEIGHBOUR_PROPERTY_ID = '1002';

/** Ten years out, so a mortgage threshold of a few years is satisfiable. */
export const VALIDITY_PERIOD = BigInt(Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600);

export function receiptRecord(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    propertyId: PROPERTY_ID,
    ownerCommitment: '0',
    // LEASE with a real end date, so the mortgage circuit's term check has
    // something to compare; a PERPETUAL plot would skip it (D5/D23).
    useType: 0,
    validityPeriod: VALIDITY_PERIOD.toString(),
    encumbranceStatus: 0,
    tenureType: 1,
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
    ...overrides,
  };
}

export interface SampleBundle {
  bundle: OwnerBundle;
  record: LURRecord;
  /** What GET /api/proof/:propertyId would return for this tree. */
  refreshed: MerkleProofResponse;
  rootDecimal: string;
}

/**
 * A two-leaf tree (the subject plus a neighbour) so the Merkle path has at
 * least one non-zero sibling — a single-leaf tree would pass a path check that
 * ignored the siblings entirely.
 */
export async function sampleBundle(
  overrides: Partial<ReceiptRecord> = {},
): Promise<SampleBundle> {
  const ownerCommitment = (await poseidonHash([OWNER_SECRET])).toString();
  const neighbourCommitment = (await poseidonHash([NEIGHBOUR_SECRET])).toString();

  const subject = receiptRecord({ ownerCommitment, ...overrides });
  const neighbour = receiptRecord({
    propertyId: NEIGHBOUR_PROPERTY_ID,
    ownerCommitment: neighbourCommitment,
  });

  const record = await receiptToLURRecordAsync(subject);
  const neighbourRecord = await receiptToLURRecordAsync(neighbour);

  const tree = await buildTree([record, neighbourRecord]);
  const proof = await generateMerkleProof(tree, record);
  const leaf = await hashRecord(record);

  const receipt: Receipt = {
    issuedOn: '2026-01-15T00:00:00.000Z',
    transactionHash: '0x' + 'ab'.repeat(32),
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    rootVersion: 2,
    merkleRoot: tree.root.toString(),
    propertyId: subject.propertyId,
    leaf: leaf.toString(),
    merkleProof: {
      siblings: proof.siblings.map((sibling) => sibling.toString()),
      pathIndices: proof.pathIndices,
    },
    record: subject,
    issuer: {
      ethereumAccount: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      ethereumAccountSignature: 'AA==',
      IssuerCertificateChain: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n',
    },
  };

  return {
    bundle: {
      receipt,
      secret: { propertyId: subject.propertyId, ownerSecret: OWNER_SECRET.toString() },
    },
    record,
    rootDecimal: tree.root.toString(),
    refreshed: {
      propertyId: subject.propertyId,
      leaf: leaf.toString(),
      merkleRoot: tree.root.toString(),
      rootVersion: 2,
      siblings: proof.siblings.map((sibling) => sibling.toString()),
      pathIndices: proof.pathIndices,
      contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      onChain: { root: tree.root.toString(), version: 2 },
      inSync: true,
      source: 'rebuilt',
    },
  };
}
