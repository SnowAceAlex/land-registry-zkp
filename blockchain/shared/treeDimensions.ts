/**
 * shared/treeDimensions.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The two numbers that fix the shape of the Merkle tree (D20/D41).
 *
 * ⚠️  THIS FILE MUST STAY DEPENDENCY-FREE. It exists so a browser page can
 *     learn the tree's dimensions without loading any cryptography.
 *
 *     `merkleTree.ts` imports `circomlibjs` at the top level, and the shared
 *     barrel re-exports `merkleTree.ts`, so importing `MAX_PROPERTY_ID` from
 *     `@land-registry/blockchain/shared` drags circomlibjs → ffjavascript →
 *     web-worker into the bundle: about 3 MB, to learn one integer. That is
 *     the right trade for a page that hashes (the transfer counter, the proof
 *     page) and the wrong one for a page that only validates a form field —
 *     `/resident/lookup` was 3.7 MB before this split.
 *
 *     Pages that need only dimensions import
 *     `@land-registry/blockchain/shared/treeDimensions` directly. Everything
 *     else keeps importing from the barrel: `merkleTree.ts` re-exports both
 *     names, so no existing import changed.
 *
 * These are dimensions, not logic. The design rule that all Merkle/Poseidon
 * LOGIC lives in `blockchain/shared/` is untouched — this is still the one
 * place either number is defined.
 */

/**
 * Fixed depth of the sparse tree (D20). Not derived from the record count: a
 * fixed depth is what lets the circuit have a fixed number of constraints, and
 * what keeps every proof the same size no matter how full the registry is.
 */
export const TREE_DEPTH = 20;

/**
 * Highest usable `propertyId` (D41).
 *
 * A leaf's index IS its `propertyId`, so the depth is also the registry's hard
 * id range: 0 … 2^20 − 1 = 1 048 575. `buildTree()` enforces it, and a lookup
 * form should refuse an out-of-range id before spending a request on it.
 */
export const MAX_PROPERTY_ID = (1n << BigInt(TREE_DEPTH)) - 1n;
