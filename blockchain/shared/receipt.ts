/**
 * shared/receipt.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The wire format of an issued `receipt.json` (D31, §3.1) and the one way to
 * turn it back into an `LURRecord`.
 *
 * WHY THIS IS SHARED. A receipt has one writer (the backend issuance flow) and
 * several readers: `scripts/tools/verifyReceipt.ts`, `scripts/tools/transferSmoke.ts`, and
 * the Phase 9 browser verifier. Each reader has to rebuild the exact leaf the
 * registry hashed, which means naming all ten descriptive fields and applying
 * the `area` conversion below. That reconstruction was written out by hand four
 * times; nothing tied the copies together, and a divergence would not throw —
 * it would silently produce a leaf that is not in the tree, which reads as
 * "your proof is invalid" rather than "the code disagrees with itself".
 *
 * So the types live here, both sides of the wire share them, and the
 * reconstruction exists once.
 *
 * ⚠️ The field names — including `IssuerCertificateChain`'s capital I, inherited
 * from [SmartCert] §3.3 — are the on-disk format of bundles already handed to
 * owners. Renaming one breaks every issued bundle.
 *
 * Browser-safety: this module is pure types plus field mapping. The only
 * hashing it triggers is `hashOffchainMetadata`, which the barrel already
 * exposes.
 */

import { hashOffchainMetadata, OffchainMetadata } from './offchainMetadata';
import { EncumbranceStatus, LURRecord, TenureType, UseType } from './types';

export interface ReceiptMerkleProof {
  siblings: string[];
  pathIndices: number[];
}

/**
 * The issuer's identity chain (D30). A verifier checks all three links —
 * certificate → CA, keccak256(O) → on-chain `authorityInstitute`, and the
 * signature → certificate key — before trusting the root the receipt names.
 */
export interface IssuerBlock {
  ethereumAccount: string;
  ethereumAccountSignature: string;
  /** PEM. Field name keeps [SmartCert]'s capital I — inherited, not a typo. */
  IssuerCertificateChain: string;
}

/**
 * Off-chain descriptive metadata (D3/D19) — printed on the certificate, never
 * stored on-chain, but committed to the leaf through `offchainHash` (D36).
 *
 * Split out from {@link ReceiptRecord} because the backend needs to produce
 * exactly this set from a database row, and {@link receiptOffchainMetadata}
 * reads nothing else. Naming the subset means the two cannot drift apart.
 */
export interface ReceiptDescriptiveFields {
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
  /**
   * Square metres as a JSON number. Note this is NOT the form the commitment
   * hashes — see {@link receiptOffchainMetadata}.
   */
  area: number;
  issuingAuthority: string;
  /** ISO date, YYYY-MM-DD */
  issueDate: string;
}

export interface ReceiptRecord extends ReceiptDescriptiveFields {
  // ── The 6 on-chain leaf fields, in D4 order ────────────────────────────────
  propertyId: string;
  ownerCommitment: string;
  useType: number;
  validityPeriod: string;
  encumbranceStatus: number;
  tenureType: number;
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

/**
 * secret.json — the half that must never be shared and never leaves the
 * owner's possession (D14/D31). `ownerSecret` must NEVER appear in a Receipt.
 */
export interface OwnerSecretFile {
  propertyId: string;
  ownerSecret: string;
}

/**
 * The descriptive fields in the exact shape the commitment digest expects.
 *
 * This is where the one genuinely lossy step lives: the receipt carries `area`
 * as a JSON number, while the digest is defined over a 2-decimal string. Both
 * are deliberate — a number is what the PDF and the UI want, a fixed-precision
 * string is what makes the hash reproducible — but the conversion between them
 * is a rule, and a rule copied into three readers is a rule that will
 * eventually differ in one of them.
 */
export function receiptOffchainMetadata(record: ReceiptDescriptiveFields): OffchainMetadata {
  return {
    landUseCode: record.landUseCode,
    landUserType: record.landUserType ?? null,
    certificateSerial: record.certificateSerial,
    bookEntryNumber: record.bookEntryNumber,
    mapSheetNumber: record.mapSheetNumber ?? null,
    landOrigin: record.landOrigin ?? null,
    address: record.address,
    area: Number(record.area).toFixed(2),
    issuingAuthority: record.issuingAuthority,
    issueDate: record.issueDate,
  };
}

/**
 * Rebuild the canonical `LURRecord` from a receipt — the record whose Poseidon
 * hash must equal the `leaf` the receipt claims.
 *
 * Callers should recompute the leaf from this rather than trusting
 * `receipt.leaf` as written: the Merkle proof only ever speaks about the leaf
 * number, so an edited `area` or `address` leaves the proof verifying while the
 * certificate says something the registry never attested.
 *
 * Phase 9 note: the browser verifier needs an async twin of this that calls
 * `hashOffchainMetadataAsync` (node:crypto is unavailable there). Add it beside
 * this function so the field mapping still exists once.
 */
export function receiptToLURRecord(record: ReceiptRecord): LURRecord {
  return {
    propertyId: BigInt(record.propertyId),
    ownerCommitment: BigInt(record.ownerCommitment),
    useType: record.useType as UseType,
    validityPeriod: BigInt(record.validityPeriod),
    encumbranceStatus: record.encumbranceStatus as EncumbranceStatus,
    tenureType: record.tenureType as TenureType,
    offchainHash: hashOffchainMetadata(receiptOffchainMetadata(record)),
  };
}
