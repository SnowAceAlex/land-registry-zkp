/**
 * The counter's whole cryptographic path, against the real trusted-setup
 * artifacts: a bundle the seller hands over → checkSellerBundle → a preview
 * computed the way the backend computes it → buildCounterTransferInput →
 * Groth16 prove → verify.
 *
 * The unit tests pin the wiring; only an actual proof shows that the witness
 * the counter assembles satisfies transfer.circom — a swapped path or a
 * commitment computed from the wrong secret passes every other test and fails
 * only here (or, without this test, at an officer's desk).
 *
 * Proving runs through shared/zkpHelper in Node with file paths; the browser
 * worker calls the same function with URLs. Self-skips on a checkout without
 * `circuits:setup` artifacts, like the blockchain integration tests.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  type LURRecord,
  type Receipt,
  type ReceiptRecord,
  buildTree,
  generateGroth16Proof,
  generateMerkleProof,
  getCircuitPaths,
  hashRecord,
  nowUnixTimestamp,
  poseidonHash,
  receiptToLURRecordAsync,
  verifyGroth16Proof,
} from '@land-registry/blockchain/shared';
import { describe, expect, it } from 'vitest';

import type { PropertyDetail, TransferPreview } from '../../api/types';
import { generateOwnerSecret } from './buyer-secret';
import { checkSellerBundle } from './seller-check';
import { buildCounterTransferInput } from './transfer-witness';

const BLOCKCHAIN_DIR = path.resolve(import.meta.dirname, '../../../../../../../blockchain');
const paths = getCircuitPaths('transfer', BLOCKCHAIN_DIR);
const artifactsPresent = fs.existsSync(paths.zkeyPath) && fs.existsSync(paths.wasmPath);

const recordFor = (propertyId: string, ownerCommitment: string): ReceiptRecord => ({
  propertyId,
  ownerCommitment,
  useType: 0,
  validityPeriod: '0',
  encumbranceStatus: 0,
  tenureType: 0,
  landUseCode: 'ONT',
  landUserType: null,
  certificateSerial: `CT ${100000 + Number(propertyId)}`,
  bookEntryNumber: `BK-${propertyId}`,
  mapSheetNumber: '12',
  landOrigin: 'Nhà nước công nhận quyền sử dụng đất',
  address: `Số ${propertyId}, Đường Lê Lợi, Phường Sài Gòn, TP.HCM`,
  area: 120.5,
  issuingAuthority: 'Sở Nông nghiệp và Môi trường TP.HCM',
  issueDate: '2026-01-15',
});

describe.skipIf(!artifactsPresent)('counter transfer proof (integration, real zkey)', () => {
  it('proves a transfer the verification key accepts', { timeout: 120_000 }, async () => {
    // ── Registry state before the transfer: the seller's plot and a neighbour.
    const sellerSecret = generateOwnerSecret();
    const sellerCommitment = (await poseidonHash([sellerSecret])).toString();
    const sellerReceiptRecord = recordFor('1001', sellerCommitment);
    const neighbourRecord = recordFor('1002', (await poseidonHash([7n])).toString());

    const seller: LURRecord = await receiptToLURRecordAsync(sellerReceiptRecord);
    const neighbour: LURRecord = await receiptToLURRecordAsync(neighbourRecord);
    const oldTree = await buildTree([seller, neighbour]);

    // ── The bundle the seller brings, and the registry row the counter fetches.
    const receipt = {
      propertyId: '1001',
      leaf: (await hashRecord(seller)).toString(),
      record: sellerReceiptRecord,
      merkleProof: { siblings: [], pathIndices: [] },
    } as unknown as Receipt;
    const property = {
      propertyId: '1001',
      status: 'ISSUED',
      ownerCommitment: sellerCommitment,
      encumbranceStatus: 'FREE',
      landUserType: null,
    } as PropertyDetail;

    const check = await checkSellerBundle(
      { receipt, secret: { propertyId: '1001', ownerSecret: sellerSecret.toString() } },
      property,
    );
    expect(check.issues).toEqual([]);

    // ── Buyer secret at the counter, and the preview the backend would return.
    const buyerSecret = generateOwnerSecret();
    const buyerCommitment = await poseidonHash([buyerSecret]);
    const newTree = await buildTree([{ ...seller, ownerCommitment: buyerCommitment }, neighbour]);
    const oldProof = await generateMerkleProof(oldTree, seller);
    const newProof = await generateMerkleProof(newTree, { ...seller, ownerCommitment: buyerCommitment });
    const preview: TransferPreview = {
      propertyId: '1001',
      rootVersion: 1,
      oldMerkleRoot: oldTree.root.toString(),
      newMerkleRoot: newTree.root.toString(),
      oldSiblings: oldProof.siblings.map(String),
      oldPathIndices: oldProof.pathIndices,
      newSiblings: newProof.siblings.map(String),
      newPathIndices: newProof.pathIndices,
    };

    const input = buildCounterTransferInput({
      sellerRecord: check.record,
      sellerLeaf: check.leaf,
      sellerSecret,
      buyerSecret,
      buyerCommitment,
      preview,
      currentTimestamp: nowUnixTimestamp(),
      minRequiredRemainingTerm: 0n,
    });

    const pkg = await generateGroth16Proof(input, paths.wasmPath, paths.zkeyPath, 'transfer');

    expect(await verifyGroth16Proof(paths.vkeyPath, pkg.publicSignals, pkg.proof)).toBe(true);
    // The public signals carry commitments, roots and the plot id — never a secret.
    expect(pkg.publicSignals).not.toContain(sellerSecret.toString());
    expect(pkg.publicSignals).not.toContain(buyerSecret.toString());
  });
});
