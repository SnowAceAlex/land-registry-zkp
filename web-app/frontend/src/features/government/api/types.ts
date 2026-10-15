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

export type ActorScope = 'CENTRAL' | 'BRANCH';
export type LandOfficeKind = 'HEAD_OFFICE' | 'SITE' | 'BRANCH';

/** GET /government/me — which office the API key belongs to (D86). */
export interface Me {
  office: { code: string; name: string; kind: LandOfficeKind };
  scope: ActorScope;
}

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

/** POST /government/changesets and drafts/open (D53). */
export interface ChangeSetDraftDetail {
  kind: 'changeset';
  id: number;
  newRoot: string;
  createdAt: string;
  issuanceRequestIds: number[];
  transferIds: number[];
  revocationIds: number[];
  revocationCalldata: RevocationCalldata;
  /** Pending revocations left for a later round by the cap (D56). */
  deferredRevocations: number;
}

export type OpenDraft = ChangeSetDraftDetail;

/** confirm response of a change-set draft. */
export interface DraftConfirmation {
  id: number;
  rootVersion: number;
  txHash: string | null;
}

/** GET /government/changesets — ChangeSetSummary (D77, D88). */
export interface ChangeSetSummary {
  id: number;
  status: 'DRAFT' | 'PUBLISHED' | 'DISCARDED';
  newRoot: string;
  rootVersion: number | null;
  txHash: string | null;
  createdAt: string;
  publishedAt: string | null;
  issuanceCount: number;
  transferCount: number;
  revocationCount: number;
  /** One archive per office that received bundles, and how many were downloaded (D88). */
  archiveCount: number;
  archivesDownloaded: number;
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
  /** The office that filed it, the office owning the plot's area, and whether they differ (D86). */
  officeCode: string | null;
  landOfficeCode: string | null;
  byFallback: boolean;
  /** Kept out of the next round by an officer (D87). */
  held: boolean;
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

/** A revocation as GET /government/pending-changes returns it (RevocationDto, office codes not ids). */
export interface RevocationRow {
  id: number;
  propertyId: string;
  reasonCode: number;
  detailText: string;
  detailHash: string;
  status: 'PENDING' | 'PUBLISHED' | 'REJECTED';
  officeCode: string | null;
  landOfficeCode: string | null;
  byFallback: boolean;
  held: boolean;
  heldReason: string | null;
  changeSetId: number | null;
  createdAt: string;
  publishedAt: string | null;
}

/** GET /government/pending-changes — held items and items already in a draft are left out. */
export interface PendingChanges {
  issuances: IssuanceRequest[];
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

/** One issuance request — IssuanceRequestDto (D87). */
export interface IssuanceRequest {
  id: number;
  propertyId: string;
  ownerCommitment: string;
  status: 'READY' | 'PUBLISHED' | 'WITHDRAWN';
  officeCode: string;
  landOfficeCode: string | null;
  held: boolean;
  heldReason: string | null;
  changeSetId: number | null;
  createdAt: string;
  publishedAt: string | null;
}

export type QueueKind = 'issuance' | 'transfer' | 'revocation';

/** GET /government/queue — QueueItemDto: one open item of any procedure (D87). */
export interface QueueItem {
  kind: QueueKind;
  id: number;
  propertyId: string;
  /** The office that filed it, and the office owning the plot's area. */
  officeCode: string | null;
  landOfficeCode: string | null;
  status: string;
  ageHours: number;
  held: boolean;
  heldReason: string | null;
  /** A central office filed it on another office's plot. */
  byFallback: boolean;
}

export interface QueueList {
  total: number;
  items: QueueItem[];
}

/** Query of GET /government/queue; every field is optional. */
export interface QueueFilter {
  kind?: QueueKind;
  officeCode?: string;
  held?: boolean;
  olderThanDays?: number;
  skip?: number;
  take?: number;
}

export type AlertCode =
  | 'ChainAheadOfDatabase'
  | 'PendingTransfersWouldBreak'
  | 'RevocationBacklog'
  | 'StaleQueueItem'
  | 'ArchiveNotDownloaded'
  | 'ArchiveExpiredUndownloaded'
  | 'UnassignedProperties'
  | 'HeldItems'
  | 'AuthorityRoleMissing'
  | 'AttesterRoleMissing';

/** A coded alert (D89): the portal words it, the backend never does. */
export interface Alert {
  code: AlertCode;
  severity: 'error' | 'warning' | 'info';
  count?: number;
  officeCode?: string;
  /** RevocationBacklog: rounds needed. Archive alerts: the change set id. */
  ref?: number;
}

/** GET /government/operations/overview — OverviewDto (D89). */
export interface Overview {
  registry: {
    network: string;
    chainId: number;
    onChainVersion: number;
    onChainRoot: string;
    dbVersion: number | null;
    lastPublishedAt: string | null;
    lastTxHash: string | null;
    inSync: boolean;
  };
  openDraft: { id: number; newRoot: string; createdAt: string } | null;
  /** Open items; held ones are part of the three counts. A branch sees its own area. */
  queue: { issuance: number; transfer: number; revocation: number; held: number };
  revocationCap: number;
  /** Rounds the waiting (not held) revocations need at that cap. */
  roundsNeeded: number;
  alerts: Alert[];
}

/** GET /government/operations/offices — OfficeRowDto; the null row is the unassigned plots. */
export interface OfficeRow {
  officeCode: string | null;
  officeName: string | null;
  kind: LandOfficeKind | null;
  issuance: number;
  transfer: number;
  revocation: number;
  held: number;
  /** Open items a central office filed on this office's plots. */
  fallback: number;
  oldestAgeHours: number | null;
}

/** GET /government/archives and /changesets/:id/archives — ArchiveSummaryDto (D88). */
export interface ArchiveSummary {
  changeSetId: number;
  rootVersion: number | null;
  publishedAt: string | null;
  officeCode: string;
  officeName: string;
  propertyCount: number;
  expiresAt: string;
  expired: boolean;
  firstDownloadedAt: string | null;
  firstDownloadedByOfficeCode: string | null;
}
