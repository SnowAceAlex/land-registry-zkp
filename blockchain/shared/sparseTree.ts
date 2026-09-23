/**
 * shared/sparseTree.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The same fixed-depth sparse tree as D20/D41, but with nodes READ THROUGH A
 * CALLBACK instead of assembled in memory first (D72).
 *
 * WHY THIS EXISTS. `buildTree()` has to load every leaf to answer a question
 * about one leaf. At 2.5 million parcels that is ~10 million Poseidon calls
 * (~20 minutes) for every root publish, every transfer preview, and every proof
 * the cache missed — while the thing that actually changed is a few thousand
 * leaves. Here the cost is proportional to the leaves that CHANGED: a proof is
 * TREE_DEPTH reads, and a publish of k leaves is O(k·TREE_DEPTH).
 *
 * NOTHING CRYPTOGRAPHIC CHANGES. Same `zeroHashes` chain, same "leaf index IS
 * the propertyId" rule (D41), same LSB-first `pathIndices` convention, same
 * `poseidonHash`. `buildTree()` stays exactly as it was and is the reference
 * implementation: `test/shared/sparseTree.test.ts` compares the two node by
 * node, not just root to root.
 *
 * ⚠️ THE "MISSING ROW MEANS EMPTY SUBTREE" INVARIANT. A node that recomputes to
 * exactly `zeroHashes[height]` goes into `removed`, never into `touched`.
 * Storing it as an ordinary row still yields the right root, but then the table
 * grows forever and the equivalence test loses the half that matters (comparing
 * the node SET). Do not "simplify" that branch away.
 *
 * ⚠️ NO STORAGE, NO I/O, NO `node:` IMPORTS. The Postgres half lives in
 * `web-app/backend/src/tree/node-store.service.ts`. Keeping this file pure is
 * what lets it be tested against a `Map` with no database, and what keeps the
 * shared barrel importable from a browser bundle.
 */

import { poseidonHash, zeroHashes } from './merkleTree';
import { TREE_DEPTH } from './treeDimensions';
import { MerkleProofData } from './types';

export { zeroHashes };

/** A node's position: height 0 = leaf, height TREE_DEPTH = root. */
export interface NodeCoord {
  height: number;
  index: number;
}

/** Read one occupied node. `undefined` = empty subtree ⇒ zeroHashes[height]. */
export type NodeReader = (height: number, index: number) => Promise<bigint | undefined>;

/** The result of projecting a set of leaf changes. Nothing is written. */
export interface TreeOverlay {
  root: bigint;
  /** Nodes to write, keyed `${height}:${index}`. */
  touched: Map<string, bigint>;
  /** Nodes to delete — they have become empty subtrees. */
  removed: string[];
}

export function nodeKey(height: number, index: number): string {
  return `${height}:${index}`;
}

export function parseNodeKey(key: string): NodeCoord {
  const separator = key.indexOf(':');
  return {
    height: Number(key.slice(0, separator)),
    index: Number(key.slice(separator + 1)),
  };
}

/**
 * The coordinates of exactly the nodes a leaf needs from OUTSIDE its own path:
 * its sibling at every level.
 *
 * This is also a sufficient prefetch set for {@link applyLeafUpdates} — every
 * other node along the path is computed, not read. That is what lets the
 * storage layer answer a whole projection from one query.
 */
export function siblingCoordsFor(index: number): NodeCoord[] {
  const coords: NodeCoord[] = [];
  for (let height = 0; height < TREE_DEPTH; height++) {
    coords.push({ height, index: (index >> height) ^ 1 });
  }
  return coords;
}

/**
 * The Merkle proof for one leaf, using exactly TREE_DEPTH reads.
 *
 * `root` is climbed from the leaf rather than read from storage on purpose: the
 * caller can then compare it against the stored root node and find out that the
 * two disagree, which is the only cheap way to notice a half-written tree.
 */
export async function proofFrom(
  index: number,
  leaf: bigint,
  read: NodeReader,
): Promise<MerkleProofData> {
  const zeros = await zeroHashes();
  const siblings: bigint[] = [];
  const pathIndices: number[] = [];

  let current = leaf;
  for (let height = 0; height < TREE_DEPTH; height++) {
    const nodeIndex = index >> height;
    const isRightChild = (nodeIndex & 1) === 1;
    pathIndices.push(isRightChild ? 1 : 0);

    const sibling = (await read(height, nodeIndex ^ 1)) ?? zeros[height];
    siblings.push(sibling);

    const [left, right] = isRightChild ? [sibling, current] : [current, sibling];
    current = await poseidonHash([left, right]);
  }

  return { leaf, siblings, pathIndices, root: current };
}

/**
 * Project the result of k leaves changing value. `null` means the leaf is
 * removed (a revocation — D45).
 *
 * Walks BY LEVEL, not by leaf: with k leaves the paths overlap higher up, so
 * grouping per level computes each parent exactly once. Per-leaf would still be
 * correct but would recompute a node near the root up to k times — which is the
 * cost this module exists to avoid.
 */
export async function applyLeafUpdates(
  updates: Map<number, bigint | null>,
  read: NodeReader,
): Promise<TreeOverlay> {
  const zeros = await zeroHashes();
  const touched = new Map<string, bigint>();
  const removed: string[] = [];

  // Nothing changed ⇒ the root is whatever storage already holds. Without this
  // the loop below computes no parent at any level, `current` ends up empty, and
  // the fallback would confidently return the EMPTY-tree root — a wrong answer
  // that looks like a valid one. No caller passes an empty set today
  // (ChangeSetService refuses an empty round), which is exactly why the
  // primitive has to refuse to be wrong on its own.
  if (updates.size === 0) {
    return {
      root: (await read(TREE_DEPTH, 0)) ?? zeros[TREE_DEPTH],
      touched,
      removed,
    };
  }

  let current = new Map<number, bigint | null>(updates);

  const record = (height: number, level: Map<number, bigint | null>): void => {
    for (const [index, hash] of level) {
      const key = nodeKey(height, index);
      if (hash === null || hash === zeros[height]) removed.push(key);
      else touched.set(key, hash);
    }
  };

  /** A child's value: the level being computed first, then storage, then zero. */
  const childValue = async (height: number, index: number): Promise<bigint> => {
    if (current.has(index)) return current.get(index) ?? zeros[height];
    return (await read(height, index)) ?? zeros[height];
  };

  for (let height = 0; height < TREE_DEPTH; height++) {
    record(height, current);

    const parentIndices = new Set<number>();
    for (const index of current.keys()) parentIndices.add(index >> 1);

    const parents = new Map<number, bigint | null>();
    for (const parentIndex of parentIndices) {
      const left = await childValue(height, parentIndex * 2);
      const right = await childValue(height, parentIndex * 2 + 1);
      parents.set(parentIndex, await poseidonHash([left, right]));
    }
    current = parents;
  }

  // After the loop `current` is the root level (height TREE_DEPTH), at most one
  // node. It still has to be recorded — it is a row like any other.
  record(TREE_DEPTH, current);
  const root = current.get(0) ?? zeros[TREE_DEPTH];

  return { root, touched, removed };
}

/**
 * A reader that answers from an overlay first and falls through to storage.
 *
 * This is what makes it possible to take a Merkle proof IN THE PROJECTED TREE
 * before anything has been written — needed by the transfer preview (D28) and
 * by the bundles built during confirm (D42/D43), both of which must hold a
 * proof before the transaction closes.
 */
export function overlayReader(overlay: TreeOverlay, read: NodeReader): NodeReader {
  const removed = new Set(overlay.removed);
  return async (height, index) => {
    const key = nodeKey(height, index);
    if (overlay.touched.has(key)) return overlay.touched.get(key);
    if (removed.has(key)) return undefined;
    return read(height, index);
  };
}

/** A reader over a tree already built in memory — for tests and for bootstrap. */
export function readerFromTree(tree: { levels: Map<number, bigint>[] }): NodeReader {
  return async (height, index) => tree.levels[height]?.get(index);
}
