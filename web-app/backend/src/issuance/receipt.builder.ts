import { Property } from '@prisma/client';
import {
  IssuerBlock,
  LURRecord,
  MerkleProofData,
  OwnerSecretFile,
  Receipt,
  TREE_DEPTH,
} from '@land-registry/blockchain/shared';

import { serializeLURRecord, toReceiptDescriptiveFields } from '../records/record.mapper';

/**
 * receipt.builder.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds `receipt.json`, the shareable half of an issued bundle (D31, §3.1).
 *
 * The SHAPE of a receipt lives in `@land-registry/blockchain/shared` because
 * this file is only its writer — `scripts/verifyReceipt.ts`, the transfer smoke
 * script and the Phase 9 browser portal all read the same bytes back. What
 * stays here is the part that genuinely belongs to the backend: turning a Prisma
 * row plus a published root into that shape.
 *
 * The field names deliberately follow [SmartCert] §3.3's receipt — including
 * `IssuerCertificateChain`'s capital I — so the thesis can show the lineage
 * directly. Domain renames (`credentialID`→`propertyId`, `components[].hash`
 * →`leaf`, `components[].proof`→`merkleProof`) and the two additions
 * (`rootVersion`, `record`) are the documented deltas.
 *
 * ⚠️ `ownerSecret` must NEVER appear here. It lives only in secret.json
 * (D14/D31). `ownerCommitment` inside `record` is the public commitment and is
 * correct to include.
 */

export interface BuildReceiptInput {
  property: Property;
  record: LURRecord;
  merkleProof: MerkleProofData;
  rootVersion: number;
  merkleRoot: bigint;
  /** Hash of the publishRoot() transaction that made this root effective */
  transactionHash: string;
  /** RootRegistry address the root was published to */
  contractAddress: string;
  issuer: IssuerBlock;
  /** ISO-8601 with the +07:00 offset (D10). Injectable so tests are stable. */
  issuedOn: string;
}

export function buildReceipt(input: BuildReceiptInput): Receipt {
  const { property, record, merkleProof, rootVersion, merkleRoot } = input;

  // A short proof would be silently unusable: the circuits are compiled for a
  // fixed depth and the owner would only find out when proving fails.
  if (merkleProof.siblings.length !== TREE_DEPTH || merkleProof.pathIndices.length !== TREE_DEPTH) {
    throw new Error(
      `buildReceipt: expected a depth-${TREE_DEPTH} Merkle proof for property ` +
        `${property.propertyId}, got ${merkleProof.siblings.length} siblings`,
    );
  }

  return {
    issuedOn: input.issuedOn,
    transactionHash: input.transactionHash,
    contractAddress: input.contractAddress,
    rootVersion,
    merkleRoot: merkleRoot.toString(),
    propertyId: record.propertyId.toString(),
    leaf: merkleProof.leaf.toString(),
    merkleProof: {
      siblings: merkleProof.siblings.map((s) => s.toString()),
      pathIndices: [...merkleProof.pathIndices],
    },
    // Both halves come from the mappers, never from ad-hoc field lists: the
    // descriptive half is the same function that feeds the leaf commitment, so
    // the receipt cannot describe a record the leaf does not attest.
    record: {
      ...serializeLURRecord(record),
      ...toReceiptDescriptiveFields(property),
    },
    issuer: input.issuer,
  };
}

export function buildSecretFile(propertyId: bigint, ownerSecret: bigint): OwnerSecretFile {
  return {
    propertyId: propertyId.toString(),
    ownerSecret: ownerSecret.toString(),
  };
}
