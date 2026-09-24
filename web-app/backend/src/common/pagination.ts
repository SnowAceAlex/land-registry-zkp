import { Property } from '@prisma/client';

/**
 * common/pagination.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The list-endpoint conventions, in one place.
 *
 * `RecordsService.findAll` and `GovernmentService.listProperties` had grown the
 * same three rules independently — default 50, cap 200, and the JSON shape of a
 * property row. Two copies of a page cap is how one endpoint quietly stops
 * agreeing with the other about what "take=1000" means.
 */

const DEFAULT_PAGE_SIZE = 50;

/** Hard ceiling. The original reason — a row carried a full Merkle proof, so a
 *  big page was a multi-megabyte response — died with the proof cache (D72).
 *  The cap stays for the reason that outlived it: `GET /api/records*` is
 *  unauthenticated (D39/D50), and an unbounded page hands out the whole
 *  cadastre's propertyId → ownerCommitment map in one request. */
const MAX_PAGE_SIZE = 200;

export interface PaginationParams {
  skip?: number;
  take?: number;
}

export interface PageResult<T> {
  total: number;
  items: T[];
}

/** Normalised `skip`/`take` for a Prisma `findMany`. */
export function pageArgs(params: PaginationParams = {}): { skip: number; take: number } {
  return {
    skip: params.skip ?? 0,
    take: Math.min(params.take ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

/**
 * Parse the `skip`/`take` query strings a controller receives.
 *
 * `undefined` rather than `0` for absent values, so {@link pageArgs} applies its
 * defaults instead of being handed a deliberate-looking zero.
 */
export function parsePageQuery(skip?: string, take?: string): PaginationParams {
  return {
    skip: skip ? Number(skip) : undefined,
    take: take ? Number(take) : undefined,
  };
}

/**
 * Two serializers, deliberately not one.
 *
 * The previous single `serializeProperty` did `{ ...property }` — it spread
 * whatever Prisma row it was handed onto the response. That meant every
 * column added to the schema in the future was published by default, with no
 * decision point: the descriptive certificate fields (address, area,
 * certificate serial, book entry number, map sheet number, land origin,
 * issuing authority, issue date) and internal bookkeeping (id, createdAt,
 * updatedAt, issuedAt, issuanceBatchId) all leaked onto the unauthenticated
 * `GET /api/records*` routes even though `mortgage.circom` exists specifically
 * so a bank never has to see `encumbranceStatus`/`validityPeriod` directly.
 *
 * Going forward, exposing a new field means adding it to one of the two
 * explicit lists below — a deliberate act, not an accident of `...spread`.
 */

/** Fields safe for `GET /api/records*` — unauthenticated. Every one of these
 *  is already public by another route: `propertyId`/`ownerCommitment` are
 *  public circuit signals, `leaf` is the Poseidon leaf hash the Merkle proof
 *  endpoint (`GET /api/proof/:propertyId`) already discloses, `status` mirrors
 *  the on-chain `revocations` mapping, and `rootVersion` says which published
 *  root this plot's leaf last changed in (D72). Deliberately excluded: every descriptive certificate
 *  field, the Merkle path itself (it belongs to the proof endpoint, which
 *  computes it from `merkle_nodes` — D72), and internal columns
 *  (`id`, `createdAt`, `updatedAt`, `issuedAt`, `issuanceBatchId`) —
 *  `updatedAt` in particular would tell an observer which plot last changed
 *  hands, which the anonymised history endpoint is designed not to reveal. */
export function serializePropertyPublic<
  T extends Pick<Property, 'propertyId' | 'ownerCommitment' | 'status' | 'leaf' | 'rootVersion'>,
>(property: T) {
  return {
    propertyId: property.propertyId,
    ownerCommitment: property.ownerCommitment,
    status: property.status,
    leaf: property.leaf,
    rootVersion: property.rootVersion,
  };
}

/**
 * The full property row, JSON-safe, for the guarded `/api/government/*`
 * routes only (an officer behind `ApiKeyGuard`).
 *
 * One conversion that must not be re-derived per endpoint: Prisma's `Decimal`
 * has no JSON representation. `status` is a stored column (D45) — the source
 * of truth for tree membership — not a presentation derived from `issuedAt`:
 * a REVOKED property still has `issuedAt` set (it was issued once) but must
 * not be reported as ISSUED, which deriving from `issuedAt` alone cannot
 * express.
 */
export function serializePropertySummary<
  T extends Pick<
    Property,
    | 'propertyId'
    | 'landUseCode'
    | 'address'
    | 'area'
    | 'useType'
    | 'tenureType'
    | 'encumbranceStatus'
    | 'validityPeriod'
    | 'ownerCommitment'
    | 'rootVersion'
    | 'issuedAt'
    | 'status'
  >,
>(property: T) {
  return {
    propertyId: property.propertyId,
    landUseCode: property.landUseCode,
    address: property.address,
    area: Number(property.area),
    useType: property.useType,
    tenureType: property.tenureType,
    encumbranceStatus: property.encumbranceStatus,
    validityPeriod: property.validityPeriod,
    ownerCommitment: property.ownerCommitment,
    rootVersion: property.rootVersion,
    issuedAt: property.issuedAt,
    status: property.status,
  };
}

/**
 * One property in full, for the guarded single-record route. Explicit for the
 * same reason as the other two: a `...spread` here would mean the next column
 * added to the schema silently joins an API response nobody re-reviewed.
 *
 * Deliberately still absent: `id`, `createdAt`, `updatedAt`, `issuanceBatchId`,
 * `leaf`. Those are internal bookkeeping; the Merkle path belongs to the proof
 * endpoint, and an officer who needs the rest can query the database.
 */
export function serializePropertyFull<
  T extends Parameters<typeof serializePropertySummary>[0] &
    Pick<
      Property,
      | 'certificateSerial'
      | 'bookEntryNumber'
      | 'landUserType'
      | 'culturalPreservation'
      | 'mapSheetNumber'
      | 'landOrigin'
      | 'issuingAuthority'
      | 'issueDate'
    >,
>(property: T) {
  return {
    ...serializePropertySummary(property),
    certificateSerial: property.certificateSerial,
    bookEntryNumber: property.bookEntryNumber,
    landUserType: property.landUserType,
    culturalPreservation: property.culturalPreservation,
    mapSheetNumber: property.mapSheetNumber,
    landOrigin: property.landOrigin,
    issuingAuthority: property.issuingAuthority,
    issueDate: property.issueDate,
  };
}
