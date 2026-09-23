import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, Property } from '@prisma/client';
import {
  MerkleProofData,
  NodeCoord,
  NodeReader,
  TreeOverlay,
  applyLeafUpdates,
  hashRecord,
  nodeKey,
  overlayReader,
  parseNodeKey,
  proofFrom,
  siblingCoordsFor,
  zeroHashes,
} from '@land-registry/blockchain/shared';
import { TREE_DEPTH } from '@land-registry/blockchain/shared/treeDimensions';

import { PrismaService } from '../prisma/prisma.service';
import { toLURRecord } from '../records/record.mapper';

/**
 * Largest number of rows in one read or write statement.
 *
 * Not an arbitrary round number: each row costs two bound parameters on a read
 * and three on a write, and the PostgreSQL wire protocol accepts at most 65,535
 * parameters per statement. 5,000 rows is 15,000 parameters — safe, and still
 * large enough that a 3,000-leaf publish fits in about ten statements.
 */
export const WRITE_CHUNK_SIZE = 5_000;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * NodeStoreService — the Merkle tree, living in Postgres (D72)
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the STORAGE layer, not the cryptographic one: every hash and every
 * decision about the tree's shape belongs to `shared/sparseTree.ts`. What lives
 * here is SQL, plus the job of prefetching exactly the nodes that engine is
 * about to ask for.
 *
 * WHY PREFETCH. `NodeReader` is an async callback, so a naive "one query per
 * call" implementation turns a single proof into TREE_DEPTH round trips. But
 * the set of EXTERNAL nodes the engine needs is knowable up front: exactly
 * `siblingCoordsFor()` of each leaf being asked about, and nothing else — every
 * other node on the path is computed rather than read. So this reads once and
 * hands back a reader over a Map.
 *
 * ⚠️ `index` is a PostgreSQL keyword in some positions. Every raw statement in
 * this file MUST write `"index"` in double quotes. Drop the quotes and nothing
 * fails until runtime.
 */
@Injectable()
export class NodeStoreService {
  private readonly logger = new Logger(NodeStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The stored root. An empty table means an empty tree, which is not an error. */
  async rootNow(): Promise<bigint> {
    const zeros = await zeroHashes();
    const row = await this.prisma.merkleNode.findUnique({
      where: { height_index: { height: TREE_DEPTH, index: 0 } },
    });
    return row ? BigInt(row.hash) : zeros[TREE_DEPTH];
  }

  /** A plot's leaf, computed from the record — never read from the `leaf` column. */
  async leafFor(property: Property): Promise<bigint> {
    return hashRecord(toLURRecord(property));
  }

  /**
   * A reader preloaded with exactly the siblings of the given leaves.
   *
   * A coordinate outside the prefetch set is still answered — with one extra
   * query — and logged. It should never happen; if it does, the assumption
   * "the prefetch set is sufficient" has broken somewhere and that needs to be
   * visible rather than quietly slow.
   */
  async prefetchReader(leafIndices: number[]): Promise<NodeReader> {
    const coords: NodeCoord[] = [];
    const wanted = new Set<string>();

    for (const index of leafIndices) {
      coords.push({ height: 0, index });
      wanted.add(nodeKey(0, index));
      for (const coord of siblingCoordsFor(index)) {
        coords.push(coord);
        wanted.add(nodeKey(coord.height, coord.index));
      }
    }
    const snapshot = await this.readMany(coords);

    return async (height, index) => {
      const key = nodeKey(height, index);
      if (snapshot.has(key)) return snapshot.get(key);
      // Already fetched and genuinely absent — an empty subtree.
      if (wanted.has(key)) return undefined;

      this.logger.warn(`node (${height},${index}) read outside the prefetch set`);
      const row = await this.prisma.merkleNode.findUnique({
        where: { height_index: { height, index } },
      });
      return row ? BigInt(row.hash) : undefined;
    };
  }

  /** The current Merkle proof for a plot: TREE_DEPTH lookups, one query. */
  async proofFor(property: Property): Promise<MerkleProofData> {
    const index = Number(property.propertyId);
    const leaf = await this.leafFor(property);
    const read = await this.prefetchReader([index]);

    // The same guard `generateMerkleProof()` carried: if the leaf computed from
    // the row differs from the leaf sitting in the tree, the row and the tree
    // have diverged. Handing back a proof for the old leaf would fail later —
    // when the owner tries to prove something — instead of here.
    const stored = await read(0, index);
    if (stored !== undefined && stored !== leaf) {
      throw new ServiceUnavailableException(
        `Property ${property.propertyId} hashes to ${leaf} but the tree holds ${stored}. ` +
          `The database row and the Merkle tree have diverged — run tree:bootstrap.`,
      );
    }

    return proofFrom(index, leaf, read);
  }

  /** The Merkle proof in the PROJECTED tree, before the overlay is written. */
  async proofInOverlay(
    property: Property,
    leaf: bigint,
    overlay: TreeOverlay,
  ): Promise<MerkleProofData> {
    const index = Number(property.propertyId);
    const read = await this.prefetchReader([index]);
    return proofFrom(index, leaf, overlayReader(overlay, read));
  }

  /** Project k changed leaves. Writes nothing. */
  async projectRoot(updates: Map<number, bigint | null>): Promise<TreeOverlay> {
    const read = await this.prefetchReader([...updates.keys()]);
    return applyLeafUpdates(updates, read);
  }

  /**
   * Statements that write an overlay — RETURNED, not executed, so the caller can
   * run them inside its own `$transaction`. That is what keeps the tree and the
   * business rows changing together or not at all (the atomicity D43 relies on).
   *
   * DELETE runs before INSERT. A node cannot currently be in both `removed` and
   * `touched`, but this ordering makes that harmless if it ever becomes possible.
   */
  applyStatements(overlay: TreeOverlay): Prisma.PrismaPromise<unknown>[] {
    const statements: Prisma.PrismaPromise<unknown>[] = [];

    for (const part of chunk(overlay.removed, WRITE_CHUNK_SIZE)) {
      const tuples = part.map((key) => {
        const { height, index } = parseNodeKey(key);
        return Prisma.sql`(${height}, ${index})`;
      });
      statements.push(
        this.prisma.$executeRaw(
          Prisma.sql`DELETE FROM merkle_nodes WHERE (height, "index") IN (${Prisma.join(tuples)})`,
        ),
      );
    }

    for (const part of chunk([...overlay.touched.entries()], WRITE_CHUNK_SIZE)) {
      const values = part.map(([key, hash]) => {
        const { height, index } = parseNodeKey(key);
        return Prisma.sql`(${height}, ${index}, ${hash.toString()})`;
      });
      statements.push(
        this.prisma.$executeRaw(
          Prisma.sql`INSERT INTO merkle_nodes (height, "index", hash) VALUES ${Prisma.join(values)} ON CONFLICT (height, "index") DO UPDATE SET hash = EXCLUDED.hash`,
        ),
      );
    }

    return statements;
  }

  // ───────────────────────────────────────────────────────────────────────────

  /** Read many nodes in as few queries as possible. Duplicates dropped first. */
  private async readMany(coords: NodeCoord[]): Promise<Map<string, bigint>> {
    const unique = new Map<string, NodeCoord>();
    for (const coord of coords) unique.set(nodeKey(coord.height, coord.index), coord);

    const found = new Map<string, bigint>();
    for (const part of chunk([...unique.values()], WRITE_CHUNK_SIZE)) {
      const tuples = part.map((coord) => Prisma.sql`(${coord.height}, ${coord.index})`);
      const rows = await this.prisma.$queryRaw<{ height: number; index: number; hash: string }[]>(
        Prisma.sql`SELECT height, "index", hash FROM merkle_nodes WHERE (height, "index") IN (${Prisma.join(tuples)})`,
      );
      for (const row of rows) found.set(nodeKey(row.height, row.index), BigInt(row.hash));
    }
    return found;
  }
}
