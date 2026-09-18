/**
 * shared/merkleTree.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Merkle tree utilities using Poseidon hash (ZK-friendly).
 *
 * ⚠️  IMPORTANT DESIGN RULE:
 *   All Merkle tree / Poseidon hash logic lives EXCLUSIVELY here.
 *   Both backend (chain.service.ts) and frontend (lib/zkp.ts) must import
 *   from '@land-registry/blockchain/shared' — NEVER copy this logic elsewhere.
 *
 * Fixed-depth-20 sparse tree (D20):
 *   The circuits' MerkleProof(levels) template always processes exactly 20
 *   levels — there's no variable-depth mechanism. So every proof must look
 *   as if it came from a full 2^20-leaf tree, even when the real record
 *   count is small. Building a literal 2^20-leaf tree would take ~2M
 *   Poseidon calls per rebuild, so instead we only store the real leaves and
 *   fall back to precomputed "empty subtree hash per level" (zeroHashes) for
 *   missing siblings — the standard Tornado-Cash/Semaphore technique. This
 *   is O(N) instead of O(2^20) and produces identical roots/proofs to what a
 *   literal 2^20-leaf tree (padded with the same empty-leaf sentinel) would.
 *
 *   Leaf position is keyed by `propertyId` (D41): a record's slot IS its
 *   propertyId, not its position in the input array. That makes the build
 *   order-independent and, more importantly, pins one property to exactly one
 *   slot so a superseded leaf has no reachable path to the published root.
 */

import { buildPoseidon, Poseidon } from 'circomlibjs';
import { MAX_PROPERTY_ID, TREE_DEPTH } from './treeDimensions';
import { LURRecord, MerkleProofData } from './types';

/**
 * Re-exported so every existing importer — and the shared barrel — keeps
 * finding these here. They are DEFINED in `treeDimensions.ts`, which has no
 * dependencies, so a browser page can read the tree's dimensions without
 * pulling circomlibjs in through this module. See that file for why.
 */
export { MAX_PROPERTY_ID, TREE_DEPTH };

/** Sentinel value for an empty leaf (level 0 of the zero-hash chain). */
const EMPTY_LEAF = 0n;

// ─────────────────────────────────────────────────────────────────────────────
// Poseidon Hash Utilities
// ─────────────────────────────────────────────────────────────────────────────

let poseidonInstance: Poseidon | undefined;

async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/**
 * Poseidon hash of an array of field elements.
 * @param inputs Array of bigint values to hash (max ~16 inputs for Poseidon)
 * @returns      The Poseidon hash as a bigint
 */
export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs);
  return BigInt(poseidon.F.toString(hash));
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Leaf Hashing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The order of the 7 fields hashed into a leaf (D4) — the ONLY TypeScript-side
 * copy. The circuit-side copy is `LeafHasher()` in
 * `circuits/common/leafHasher.circom`; drift between the two is caught by the
 * positive tests in `test/circuits/{ownership,mortgage,transfer}.test.ts`.
 *
 * Exported because readers need the list as data, not just as a hash: the
 * Phase-9 verifier page derives "which fields were never revealed" by
 * subtracting a circuit's `PUBLIC_SIGNAL_ORDER` from this (D67). Retyping the
 * names there would be a second copy, and a silent one.
 *
 * ⚠️  Never reorder. `hashRecord` maps over this array, so a reorder here is a
 *     reorder of every leaf in the tree.
 */
export const LEAF_FIELD_ORDER = [
  'propertyId',
  'ownerCommitment',
  'useType',
  'validityPeriod',
  'encumbranceStatus',
  'tenureType',
  'offchainHash',
] as const satisfies readonly (keyof LURRecord)[];

/**
 * Compute the Poseidon leaf hash for a LUR record.
 * leaf = Poseidon([propertyId, ownerCommitment, useType, validityPeriod,
 *                  encumbranceStatus, tenureType, offchainHash])
 * This exact field order must match the circom circuits (D4) — it is
 * {@link LEAF_FIELD_ORDER}, and nothing else here restates it.
 *
 * `BigInt()` covers both member types: four fields are already `bigint`, the
 * other three are numeric enums (`useType`, `encumbranceStatus`, `tenureType`).
 */
export async function hashRecord(record: LURRecord): Promise<bigint> {
  return poseidonHash(LEAF_FIELD_ORDER.map((field) => BigInt(record[field])));
}

// ─────────────────────────────────────────────────────────────────────────────
// Zero-hash chain (empty subtree hash per level)
// ─────────────────────────────────────────────────────────────────────────────

let zeroHashesCache: bigint[] | undefined;

/** zeroHashes[i] = the root of an empty subtree of height i. zeroHashes[0] = EMPTY_LEAF. */
async function getZeroHashes(): Promise<bigint[]> {
  if (zeroHashesCache) return zeroHashesCache;
  const zeroHashes: bigint[] = [EMPTY_LEAF];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    const prev = zeroHashes[i - 1];
    zeroHashes.push(await poseidonHash([prev, prev]));
  }
  zeroHashesCache = zeroHashes;
  return zeroHashes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merkle Tree Construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A fixed-depth-20 sparse Merkle tree, keyed by propertyId (D41).
 *
 * Only occupied nodes are stored. `levels[h]` maps a node index at height h to
 * its hash; a missing entry means "empty subtree", answered by zeroHashes[h].
 * levels[0] holds the leaves, levels[TREE_DEPTH] holds at most the root.
 */
export interface LURMerkleTree {
  readonly depth: number;
  /** levels[h]: node index at height h -> hash. Occupied nodes only. */
  readonly levels: Map<number, bigint>[];
  readonly zeroHashes: bigint[];
  readonly root: bigint;
  /** propertyId (stringified) -> leaf index. Always Number(propertyId) (D41). */
  readonly indexByPropertyId: Map<string, number>;
}

/**
 * Build the registry tree. A record's leaf goes at index = its propertyId, so
 * the input order does not affect the result (this is what supersedes D24).
 *
 * ⚠️ D41 — why the position is a function of the record and not of the caller:
 * if the builder could choose positions, it could place two leaves for the same
 * propertyId (an old owner and a new one) in one tree, and both would produce
 * valid ownership proofs against the published root. Binding the position to
 * propertyId, and forcing the circuit to prove that binding, makes a stale leaf
 * unreachable: one slot holds one value.
 */
export async function buildTree(records: LURRecord[]): Promise<LURMerkleTree> {
  const zeroHashes = await getZeroHashes();

  const levels: Map<number, bigint>[] = [new Map<number, bigint>()];
  const indexByPropertyId = new Map<string, number>();

  for (const record of records) {
    if (record.propertyId < 0n || record.propertyId > MAX_PROPERTY_ID) {
      throw new Error(
        `buildTree: propertyId ${record.propertyId} is outside the addressable range ` +
          `0..${MAX_PROPERTY_ID} of a depth-${TREE_DEPTH} tree (D41)`,
      );
    }

    const key = record.propertyId.toString();
    // propertyId is documented as unique — fail fast instead of silently
    // overwriting the slot (which would drop one owner's leaf without a trace).
    if (indexByPropertyId.has(key)) {
      throw new Error(`buildTree: duplicate propertyId ${record.propertyId}`);
    }

    const index = Number(record.propertyId);
    indexByPropertyId.set(key, index);
    levels[0].set(index, await hashRecord(record));
  }

  for (let height = 0; height < TREE_DEPTH; height++) {
    const current = levels[height];
    const parents = new Map<number, bigint>();

    // Two siblings share one parent, so collect parent indices first rather
    // than hashing the same parent twice.
    const parentIndices = new Set<number>();
    for (const index of current.keys()) {
      parentIndices.add(index >> 1);
    }

    for (const parentIndex of parentIndices) {
      const left = current.get(parentIndex * 2) ?? zeroHashes[height];
      const right = current.get(parentIndex * 2 + 1) ?? zeroHashes[height];
      parents.set(parentIndex, await poseidonHash([left, right]));
    }

    levels.push(parents);
  }

  const root = levels[TREE_DEPTH].get(0) ?? zeroHashes[TREE_DEPTH];

  return { depth: TREE_DEPTH, levels, zeroHashes, root, indexByPropertyId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Merkle Root
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the Merkle root from a built tree.
 * @param tree A LURMerkleTree instance (from buildTree)
 * @returns    The root hash as a bigint (to publish on-chain via publishRoot())
 */
export async function getMerkleRoot(tree: LURMerkleTree): Promise<bigint> {
  return tree.root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a Merkle inclusion proof for a specific record.
 *
 * `pathIndices` is the binary expansion of the leaf index, LSB first — and by
 * D41 the leaf index is the propertyId, so the circuit can (and does) check
 * that these bits reconstruct the public propertyId signal.
 */
export async function generateMerkleProof(
  tree: LURMerkleTree,
  record: LURRecord,
): Promise<MerkleProofData> {
  const index = tree.indexByPropertyId.get(record.propertyId.toString());
  if (index === undefined) {
    throw new Error(`generateMerkleProof: propertyId ${record.propertyId} not found in tree`);
  }

  // Recompute the leaf and ensure it matches the tree. Guards against a caller
  // passing a record whose fields drifted from what the tree was built with —
  // otherwise they'd get a proof for a stale leaf that silently fails to match
  // the circuit-computed leaf downstream.
  const leaf = await hashRecord(record);
  if (leaf !== tree.levels[0].get(index)) {
    throw new Error(
      `generateMerkleProof: record hash does not match tree leaf for propertyId ${record.propertyId}`,
    );
  }

  const siblings: bigint[] = [];
  const pathIndices: number[] = [];

  let currentIndex = index;
  for (let height = 0; height < TREE_DEPTH; height++) {
    const isRightChild = (currentIndex & 1) === 1;
    pathIndices.push(isRightChild ? 1 : 0);

    const siblingIndex = currentIndex ^ 1;
    siblings.push(tree.levels[height].get(siblingIndex) ?? tree.zeroHashes[height]);

    currentIndex >>= 1;
  }

  return { leaf, siblings, pathIndices, root: tree.root };
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Verification (off-chain)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a Merkle proof off-chain (without calling the contract).
 * Recomputes the root from leaf + siblings + pathIndices, mirroring the
 * circuit's MerkleProof template exactly (Switcher convention:
 * pathIndices[i] === 0 means the current node is the LEFT child).
 *
 * @param proof     A MerkleProofData object
 * @param root      The expected Merkle root (from on-chain or local state)
 * @returns         true if the proof is valid for the given root
 */
export async function verifyMerkleProof(proof: MerkleProofData, root: bigint): Promise<boolean> {
  if (proof.siblings.length !== TREE_DEPTH || proof.pathIndices.length !== TREE_DEPTH) {
    return false;
  }

  let current = proof.leaf;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const sibling = proof.siblings[level];
    const pathIndex = proof.pathIndices[level];
    // Reject malformed proofs: pathIndices must be exactly 0 (left) or 1 (right).
    if (pathIndex !== 0 && pathIndex !== 1) {
      return false;
    }
    const isRightChild = pathIndex === 1;
    const [left, right] = isRightChild ? [sibling, current] : [current, sibling];
    current = await poseidonHash([left, right]);
  }

  return current === root;
}
