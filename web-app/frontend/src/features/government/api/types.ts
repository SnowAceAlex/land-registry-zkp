/**
 * features/government/api/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Response shapes of the government routes, as the portal consumes them.
 *
 * Written by hand from the backend DTOs and service return types (the backend
 * is not a workspace dependency of the frontend). Every field element — roots,
 * leaves, commitments, property ids — is a DECIMAL STRING: these exceed
 * Number.MAX_SAFE_INTEGER and JSON has no bigint. Dates arrive as ISO strings.
 */

export type PropertyStatus = 'IMPORTED' | 'ISSUED' | 'REVOKED';

/** GET /government/status — RegistryStatusResponseDto. */
export interface RegistryStatus {
  network: string;
  /** Chain of the deployment the backend reads (D54). */
  chainId: number;
  contractAddress: `0x${string}`;
  authority: `0x${string}`;
  onChain: { root: string; version: number };
  database: { root: string; version: number; txHash: string } | null;
  inSync: boolean;
}

/** GET /government/properties — PropertySummaryDto. */
export interface PropertySummary {
  propertyId: string;
  landUseCode: string;
  address: string;
  area: number;
  useType: string;
  tenureType: string;
  encumbranceStatus: string;
  validityPeriod: string;
  ownerCommitment: string | null;
  rootVersion: number | null;
  issuedAt: string | null;
  status: PropertyStatus;
}

export interface PropertyList {
  total: number;
  items: PropertySummary[];
}

/** GET /government/properties/:propertyId — PropertyDetailDto (D50). */
export interface PropertyDetail extends PropertySummary {
  certificateSerial: string;
  bookEntryNumber: string;
  landUserType: string | null;
  culturalPreservation: boolean;
  mapSheetNumber: string | null;
  landOrigin: string | null;
  issuingAuthority: string;
  issueDate: string;
}

/** Arguments of RootRegistry.publishRootWithRevocations, index-aligned (D45). */
export interface RevocationCalldata {
  propertyIds: string[];
  reasonCodes: number[];
  detailHashes: `0x${string}`[];
}

/** POST /government/issuance-batches and drafts/open (D53). */
export interface IssuanceDraftDetail {
  kind: 'issuance';
  id: number;
  newRoot: string;
  createdAt: string;
  propertyIds: string[];
}

/** POST /government/changesets and drafts/open (D53). */
export interface ChangeSetDraftDetail {
  kind: 'changeset';
  id: number;
  newRoot: string;
  createdAt: string;
  transferIds: number[];
  revocationIds: number[];
  revocationCalldata: RevocationCalldata;
  /** Pending revocations left for a later round by the cap (D56). */
  deferredRevocations: number;
}

export type OpenDraft = IssuanceDraftDetail | ChangeSetDraftDetail;
export type DraftKind = OpenDraft['kind'];

/** confirm response of either draft type. */
export interface DraftConfirmation {
  id: number;
  rootVersion: number;
  txHash: string | null;
}

/** GET /government/issuance-batches — IssuanceBatchSummary. */
export interface IssuanceBatchSummary {
  id: number;
  status: 'DRAFT' | 'PUBLISHED' | 'DISCARDED';
  newRoot: string;
  rootVersion: number | null;
  txHash: string | null;
  createdAt: string;
  publishedAt: string | null;
  archiveExpiresAt: string | null;
  propertyCount: number;
}

/** GET /government/changesets — ChangeSetSummary (D77). */
export interface ChangeSetSummary {
  id: number;
  status: 'DRAFT' | 'PUBLISHED' | 'DISCARDED';
  newRoot: string;
  rootVersion: number | null;
  txHash: string | null;
  createdAt: string;
  publishedAt: string | null;
  archiveExpiresAt: string | null;
  transferCount: number;
  revocationCount: number;
}

export type TransferStatus = 'PENDING' | 'APPROVED' | 'PUBLISHED' | 'REJECTED';

/** GET /transfers — TransferRequestDto. */
export interface TransferRequest {
  id: number;
  propertyId: string;
  newOwnerCommitment: string;
  oldRoot: string;
  newRoot: string;
  status: TransferStatus;
  rejectReason: string | null;
  txHash: string | null;
  /** The change set whose archive carries the buyer's bundle (D77). */
  changeSetId: number | null;
  createdAt: string;
  decidedAt: string | null;
}

/** POST /transfers/preview — TransferPreviewResult (D28 step 2). */
export interface TransferPreview {
  propertyId: string;
  /** The buyer's secret, issued by the registry (D77) — a private witness input. */
  newOwnerSecret: string;
  newOwnerCommitment: string;
  rootVersion: number;
  oldMerkleRoot: string;
  newMerkleRoot: string;
  oldSiblings: string[];
  oldPathIndices: number[];
  newSiblings: string[];
  newPathIndices: number[];
}

/** A Revocation row as GET /government/pending-changes returns it. */
export interface RevocationRow {
  id: number;
  propertyId: string;
  reasonCode: number;
  detailText: string;
  detailHash: string;
  status: 'PENDING' | 'PUBLISHED' | 'REJECTED';
  createdAt: string;
}

/** GET /government/pending-changes. */
export interface PendingChanges {
  transfers: TransferRequest[];
  revocations: RevocationRow[];
  revocationCap: number;
}

/** POST /government/import — ImportResult (D52). */
export interface ImportResult {
  dryRun: boolean;
  imported: number;
  skipped: number;
  errors: { row: number; propertyId?: string; message: string }[];
  warnings: { row: number; propertyId?: string; message: string }[];
  catalogEmpty: boolean;
}
