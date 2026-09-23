/**
 * features/resident/proof/lib/bundle-integrity.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What the owner's own browser checks about their bundle before spending
 * seconds proving — the browser twin of steps 3–4 of
 * `blockchain/scripts/tools/verifyReceipt.ts`.
 *
 * Every check runs on the bundle ALONE. No network call, and in particular no
 * request that could carry the secret: this module is the reason the owner can
 * be told their file is intact without anyone else seeing it.
 *
 * ⚠️ The leaf is RECOMPUTED from `record`, never read from `receipt.leaf`
 *    (D36). That is the check that actually stops something: `offchainHash`
 *    commits to the descriptive certificate fields — address, area,
 *    landUseCode — which are printed but never stored on chain. Before D36
 *    those were editable inside an issued receipt while the Merkle proof still
 *    verified. Trusting the `leaf` field would hand that hole straight back.
 *
 * Sibling of `features/government/transfers/lib/seller-check.ts`, which does
 * the same two cryptographic checks at the counter and then compares against
 * the registry row. Here there is no registry row to compare with: the owner
 * is not an officer and cannot read the guarded detail route (D50). The
 * freshness of the tree is established separately, by refreshing the Merkle
 * proof and comparing roots with the chain (D40/D64).
 */

import {
  type LURRecord,
  TREE_DEPTH,
  hashRecord,
  poseidonHash,
  receiptToLURRecordAsync,
  verifyMerkleProof,
} from '@land-registry/blockchain/shared';

import type { OwnerBundle } from '@/lib/bundle';

export type IntegrityIssue =
  /** A certificate field was edited after issuance (D36). */
  | 'leaf-mismatch'
  /** This secret.json does not open this receipt's commitment — wrong pair. */
  | 'secret-mismatch'
  /** The receipt's own Merkle proof does not reach its own root. */
  | 'merkle-mismatch'
  /** The proof is not depth-20, so it was not issued by this registry. */
  | 'depth-mismatch'
  /** The receipt header and its record disagree about which plot this is. */
  | 'property-mismatch';

export interface IntegrityReport {
  /** The record rebuilt from the receipt — the witness's record fields. */
  record: LURRecord;
  /** Poseidon leaf recomputed from that record. */
  leaf: bigint;
  issues: IntegrityIssue[];
}

export async function checkBundleIntegrity(bundle: OwnerBundle): Promise<IntegrityReport> {
  const { receipt, secret } = bundle;
  const issues: IntegrityIssue[] = [];

  // receiptToLURRecordAsync, never the synchronous twin: next.config.ts aliases
  // `crypto` to false for the client build, so the node:crypto digest path is
  // not available here. Both produce the same record (tested in blockchain/).
  const record = await receiptToLURRecordAsync(receipt.record);
  const leaf = await hashRecord(record);

  if (leaf !== BigInt(receipt.leaf)) issues.push('leaf-mismatch');

  const commitment = await poseidonHash([BigInt(secret.ownerSecret)]);
  if (commitment !== BigInt(receipt.record.ownerCommitment)) issues.push('secret-mismatch');

  if (receipt.propertyId !== receipt.record.propertyId) issues.push('property-mismatch');

  const { siblings, pathIndices } = receipt.merkleProof;
  if (siblings.length !== TREE_DEPTH || pathIndices.length !== TREE_DEPTH) {
    issues.push('depth-mismatch');
  } else {
    // Checked against the receipt's OWN root, not the chain's: this asks
    // whether the file is internally consistent. Whether that root is still
    // current is a different question, asked later against latestRoot (D64).
    const root = BigInt(receipt.merkleRoot);
    const consistent = await verifyMerkleProof(
      {
        leaf: BigInt(receipt.leaf),
        siblings: siblings.map((sibling) => BigInt(sibling)),
        pathIndices,
        root,
      },
      root,
    );
    if (!consistent) issues.push('merkle-mismatch');
  }

  return { record, leaf, issues };
}
