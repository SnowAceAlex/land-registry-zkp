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
 * Fixed depth of the sparse tree (D20, raised to 24 by D71). Not derived from
 * the record count: a fixed depth is what lets the circuit have a fixed number
 * of constraints, and what keeps every proof the same size no matter how full
 * the registry is.
 *
 * 24 is chosen from real numbers, not from taste: HCMC is synchronising ~2.5
 * million parcels, and 2^24 = 16,777,216 slots leaves 6.7x headroom for
 * subdivision. 26 (~67 million, a national frame) was declined to keep a wider
 * `.ptau` margin — see D71 in CODING_ROADMAP.md.
 *
 * ⚠️ Changing this is a migration, not a constant edit. It invalidates every
 * `.zkey`, every issued `receipt.json` (siblings are depth-long) and every row
 * of `merkle_nodes`: re-run `circuits:setup`, then `tree:bootstrap`, then
 * re-issue the bundles.
 */
export const TREE_DEPTH = 24;

/**
 * Depths this registry used to issue at, oldest first (D75).
 *
 * A receipt carries a depth-long path, so every bundle issued before a depth
 * migration still has the old length. Telling that apart from a length this
 * registry never used is the difference between "ask for a fresh copy" and
 * "this file is damaged or not ours" — and saying the second to the holder of
 * a genuine certificate sends them looking for a forger instead of an office.
 *
 * Append the old value here whenever TREE_DEPTH changes. Never remove one:
 * bundles at that depth are still in people's hands.
 */
export const RETIRED_TREE_DEPTHS: readonly number[] = [20];

/**
 * Highest usable `propertyId` (D41).
 *
 * A leaf's index IS its `propertyId`, so the depth is also the registry's hard
 * id range: 0 … 2^24 − 1 = 16 777 215. `buildTree()` enforces it, and a lookup
 * form should refuse an out-of-range id before spending a request on it.
 */
export const MAX_PROPERTY_ID = (1n << BigInt(TREE_DEPTH)) - 1n;
