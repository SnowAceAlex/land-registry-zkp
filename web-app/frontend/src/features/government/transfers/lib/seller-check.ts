/**
 * features/government/transfers/lib/seller-check.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What the counter verifies about the seller's bundle before spending seconds
 * of the officer's browser on a transfer proof (D47).
 *
 * Two checks are cryptographic and run on the bundle alone, through
 * blockchain/shared (never re-derived here):
 *   - the receipt's leaf recomputes from its record — its certificate fields
 *     were not edited after issuance (D36);
 *   - the secret opens the receipt's ownerCommitment — the person at the
 *     counter holds the matching secret.json.
 * The rest compare with the registry row (GET /government/properties/:id) and
 * mirror TransfersService.requireTransferableProperty, so a plot the backend
 * would refuse is refused here with a reason instead of after proving.
 *
 * None of this establishes WHO the seller is. A commitment is pseudonymous
 * (D8): whoever holds the secret passes. Checking identity documents is the
 * officer's job — the part of a notarised transfer zero knowledge cannot reach.
 */

import {
  type LURRecord,
  hashRecord,
  poseidonHash,
  receiptToLURRecordAsync,
} from '@land-registry/blockchain/shared';

import type { OwnerBundle } from '@/lib/bundle';

import type { PropertyDetail } from '../../api/types';

export type SellerCheckIssue =
  | 'leaf-mismatch'
  | 'secret-mismatch'
  | 'not-issued'
  | 'not-current-owner'
  | 'encumbered'
  | 'community-land';

export interface SellerCheckResult {
  /** The record rebuilt from the receipt — the old record of the transfer witness. */
  record: LURRecord;
  /** Poseidon leaf of that record. */
  leaf: bigint;
  issues: SellerCheckIssue[];
}

export async function checkSellerBundle(
  bundle: OwnerBundle,
  property: PropertyDetail,
): Promise<SellerCheckResult> {
  const { receipt, secret } = bundle;
  const issues: SellerCheckIssue[] = [];

  const record = await receiptToLURRecordAsync(receipt.record);
  const leaf = await hashRecord(record);
  if (leaf !== BigInt(receipt.leaf)) issues.push('leaf-mismatch');

  const commitment = await poseidonHash([BigInt(secret.ownerSecret)]);
  if (commitment !== BigInt(receipt.record.ownerCommitment)) issues.push('secret-mismatch');

  if (property.status !== 'ISSUED') issues.push('not-issued');
  else if (property.ownerCommitment !== receipt.record.ownerCommitment) {
    issues.push('not-current-owner');
  }
  if (property.encumbranceStatus !== 'FREE') issues.push('encumbered');
  // Điều 39 khoản 2 Luật Đất đai 2024 — independent of encumbranceStatus.
  if (property.landUserType === 'CDS') issues.push('community-land');

  return { record, leaf, issues };
}
