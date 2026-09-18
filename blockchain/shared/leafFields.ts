/**
 * shared/leafFields.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The order of the 7 fields hashed into a leaf (D4) — the ONLY TypeScript-side
 * copy. The circuit-side copy is `LeafHasher()` in
 * `circuits/common/leafHasher.circom`; drift between the two is caught by the
 * positive tests in `test/circuits/{ownership,mortgage,transfer}.test.ts`.
 *
 * ⚠️  THIS FILE MUST STAY FREE OF RUNTIME IMPORTS (the `LURRecord` import is
 *     type-only and erased at compile time). It lives apart from
 *     `merkleTree.ts` for the same reason `treeDimensions.ts` does: that module
 *     imports circomlibjs at the top level, so reading this list from there
 *     would pull ~3 MB of cryptography into a page that does no hashing.
 *     `/resident/verify` needs the list — it derives "which fields were never
 *     revealed" from it (D67) — and verifies proofs without ever hashing.
 *
 * `merkleTree.ts` re-exports this, so every existing importer is unaffected,
 * and `hashRecord` maps over it — the order here IS the order of every leaf in
 * the tree. Never reorder.
 */

import type { LURRecord } from './types';

export const LEAF_FIELD_ORDER = [
  'propertyId',
  'ownerCommitment',
  'useType',
  'validityPeriod',
  'encumbranceStatus',
  'tenureType',
  'offchainHash',
] as const satisfies readonly (keyof LURRecord)[];

/** One of the 7 leaf field names. */
export type LeafField = (typeof LEAF_FIELD_ORDER)[number];
