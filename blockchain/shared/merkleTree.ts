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
 */

import { buildPoseidon, Poseidon } from 'circomlibjs';
import { LURRecord, MerkleProofData } from './types';

export const TREE_DEPTH = 20;

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
 * Compute the Poseidon leaf hash for a LUR record.
 * leaf = Poseidon([propertyId, ownerCommitment, useType, validityPeriod,
 *                  encumbranceStatus, tenureType, offchainHash])
 * This exact field order must match the circom circuits (D4) — never reorder.
 */
export async function hashRecord(record: LURRecord): Promise<bigint> {
  return poseidonHash([
    record.propertyId,
    record.ownerCommitment,
    BigInt(record.useType),
    record.validityPeriod,
    BigInt(record.encumbranceStatus),
    BigInt(record.tenureType),
    record.offchainHash,
  ]);
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

/** A fixed-depth-20 sparse Merkle tree built from real LUR record leaves. */
export interface LURMerkleTree {
  readonly depth: number;
  /** Real leaf hashes only, in the order the records were provided. */
  readonly leaves: bigint[];
  /** layers[0] = leaves; layers[i] = level-i node hashes (real nodes only, no padding stored). */
  readonly layers: bigint[][];
  readonly zeroHashes: bigint[];
  readonly root: bigint;
  /** propertyId (stringified) -> index into `leaves` for O(1) proof lookup. */
  readonly indexByPropertyId: Map<string, number>;
}

/**
 * Build a fixed-depth-20 sparse Merkle tree from an array of LUR records.
 * @param records Array of all LUR records in the registry
 * @returns       A LURMerkleTree instance
 */
export async function buildTree(records: LURRecord[]): Promise<LURMerkleTree> {
  const zeroHashes = await getZeroHashes();
  const leaves = await Promise.all(records.map(hashRecord));

  const indexByPropertyId = new Map<string, number>();
  records.forEach((record, i) => {
    const key = record.propertyId.toString();
    // propertyId is documented as unique — fail fast instead of silently
    // overwriting the index (which would yield a proof for the wrong leaf).
    if (indexByPropertyId.has(key)) {
      throw new Error(`buildTree: duplicate propertyId ${record.propertyId}`);
    }
    indexByPropertyId.set(key, i);
  });

  const layers: bigint[][] = [leaves];
  let currentLevel = leaves;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : zeroHashes[level];
      nextLevel.push(await poseidonHash([left, right]));
    }
    layers.push(nextLevel);
    currentLevel = nextLevel;
  }

  const root = currentLevel.length > 0 ? currentLevel[0] : zeroHashes[TREE_DEPTH];

  return { depth: TREE_DEPTH, leaves, layers, zeroHashes, root, indexByPropertyId };
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
 * The returned MerkleProofData is used as private input to the circom
 * circuit (siblings + pathIndices, always length 20 regardless of the
 * real record count — see the D20 note at the top of this file).
 *
 * @param tree    The LURMerkleTree instance
 * @param record  The specific LUR record to generate a proof for
 * @returns       A MerkleProofData object with leaf, siblings, pathIndices, root
 */
export async function generateMerkleProof(
  tree: LURMerkleTree,
  record: LURRecord,
): Promise<MerkleProofData> {
  const index = tree.indexByPropertyId.get(record.propertyId.toString());
  if (index === undefined) {
    throw new Error(`generateMerkleProof: propertyId ${record.propertyId} not found in tree`);
  }

  // Recompute the leaf from the provided record and ensure it matches the tree.
  // Guards against a caller passing a record whose fields drifted from what the
  // tree was built with — otherwise they'd get a proof for a stale leaf that
  // silently fails to match the circuit-computed leaf downstream.
  const leaf = await hashRecord(record);
  if (leaf !== tree.leaves[index]) {
    throw new Error(
      `generateMerkleProof: record hash does not match tree leaf for propertyId ${record.propertyId}`,
    );
  }
  const siblings: bigint[] = [];
  const pathIndices: number[] = [];

  let currentIndex = index;
  for (let level = 0; level < tree.depth; level++) {
    const isRightChild = currentIndex % 2 === 1;
    pathIndices.push(isRightChild ? 1 : 0);

    const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;
    const levelNodes = tree.layers[level];
    const sibling = siblingIndex < levelNodes.length ? levelNodes[siblingIndex] : tree.zeroHashes[level];
    siblings.push(sibling);

    currentIndex = Math.floor(currentIndex / 2);
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
