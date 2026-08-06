import { Property } from '@prisma/client';
import { LURRecord, MerkleProofData, TREE_DEPTH } from '@land-registry/blockchain/shared';

import { IssuerBlock } from './issuer.service';
import { serializeLURRecord } from '../records/record.mapper';

/**
 * receipt.builder.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds `receipt.json`, the shareable half of an issued bundle (D31, §3.1).
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

export interface ReceiptMerkleProof {
  siblings: string[];
  pathIndices: number[];
}

export interface Receipt {
  issuedOn: string;
  transactionHash: string;
  contractAddress: string;
  rootVersion: number;
  merkleRoot: string;
  propertyId: string;
  leaf: string;
  merkleProof: ReceiptMerkleProof;
  record: ReceiptRecord;
  issuer: IssuerBlock;
}

export interface ReceiptRecord {
  // 6 on-chain leaf fields, D4 order
  propertyId: string;
  ownerCommitment: string;
  useType: number;
  validityPeriod: string;
  encumbranceStatus: number;
  tenureType: number;
  // Off-chain-only metadata (D3/D19) — for display and the PDF
  landUseCode: string;
  /** Đối tượng sử dụng đất (CNV/CDS/TKT/TCC/TSN); null = cá nhân */
  landUserType: string | null;
  certificateSerial: string;
  bookEntryNumber: string;
  /** Số tờ bản đồ — a mandatory field on a real GCN */
  mapSheetNumber: string | null;
  /** Nguồn gốc sử dụng đất — a mandatory field on a real GCN */
  landOrigin: string | null;
  address: string;
  area: number;
  issuingAuthority: string;
  issueDate: string;
}

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
  if (
    merkleProof.siblings.length !== TREE_DEPTH ||
    merkleProof.pathIndices.length !== TREE_DEPTH
  ) {
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
    record: {
      ...serializeLURRecord(record),
      landUseCode: property.landUseCode,
      landUserType: property.landUserType,
      certificateSerial: property.certificateSerial,
      bookEntryNumber: property.bookEntryNumber,
      mapSheetNumber: property.mapSheetNumber,
      landOrigin: property.landOrigin,
      address: property.address,
      area: Number(property.area),
      issuingAuthority: property.issuingAuthority,
      issueDate: property.issueDate.toISOString().slice(0, 10),
    },
    issuer: input.issuer,
  };
}

/**
 * secret.json — the half that must never be shared and never leaves the
 * owner's possession (D14/D31).
 */
export interface OwnerSecretFile {
  propertyId: string;
  ownerSecret: string;
}

export function buildSecretFile(propertyId: bigint, ownerSecret: bigint): OwnerSecretFile {
  return {
    propertyId: propertyId.toString(),
    ownerSecret: ownerSecret.toString(),
  };
}
