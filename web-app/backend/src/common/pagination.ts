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

/** Hard ceiling: a property row carries a full Merkle proof, so an unbounded
 *  page is a multi-megabyte response and a slow query for nobody's benefit. */
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
 * A property row's JSON-safe form.
 *
 * Two conversions that must not be re-derived per endpoint: Prisma's `Decimal`
 * has no JSON representation, and `status` is a presentation of `issuedAt`
 * rather than a stored column — a row is ISSUED exactly when it has an issue
 * date, because that is when the owner commitment (and so the leaf) came into
 * existence (D14).
 */
export function serializeProperty<T extends Pick<Property, 'area' | 'issuedAt'>>(property: T) {
  return {
    ...property,
    area: Number(property.area),
    status: property.issuedAt ? ('ISSUED' as const) : ('IMPORTED' as const),
  };
}
