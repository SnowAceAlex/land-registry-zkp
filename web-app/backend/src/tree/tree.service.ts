import { Injectable } from '@nestjs/common';
import { Property } from '@prisma/client';
import {
  LURMerkleTree,
  MerkleProofData,
  buildTree,
  generateMerkleProof,
} from '@land-registry/blockchain/shared';

import { PrismaService } from '../prisma/prisma.service';
import { toLURRecord } from '../records/record.mapper';

/**
 * TreeService
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads issued properties from Postgres and hands them to the shared Merkle
 * layer.
 *
 * No hashing lives here. buildTree/generateMerkleProof come from
 * @land-registry/blockchain/shared — the repo-wide rule is that Merkle and
 * Poseidon logic exists in exactly one place.
 *
 * ⚠️ SINCE D72 THIS IS NOT WHERE TREE QUESTIONS ARE ANSWERED. `NodeStoreService`
 * keeps the tree in Postgres and answers in TREE_DEPTH key lookups. What is left
 * here is loading plots — by batch, through `streamIssuedProperties()` — plus
 * `buildFrom()`, the build-it-all-in-memory reference used by tests and by
 * `bootstrap()`. Building a whole tree to answer one question is the thing D72
 * removed; do not add a caller for it.
 */
@Injectable()
export class TreeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every property currently in the tree, in canonical list order (D41: no
   * longer the leaf order).
   *
   * Membership is `status === ISSUED`, not `ownerCommitment !== null` (D45): a
   * REVOKED property keeps its commitment, so the old rule could not express
   * it. Dropping the leaf is what makes revocation enforced rather than merely
   * recorded — with no leaf there is no Merkle path, so the circuit cannot
   * produce a proof at all.
   *
   * ⚠️ LOADS EVERYTHING INTO MEMORY. Only for tests and small registries — at
   * 2.5 million parcels this is 5–7 GB of Node heap (blocker S5 of D72). Every
   * real path uses {@link streamIssuedProperties} instead.
   */
  async loadIssuedProperties(): Promise<Property[]> {
    const properties = await this.prisma.property.findMany({
      where: { status: 'ISSUED' },
    });
    return sortByPropertyId(properties);
  }

  /**
   * Every property in the tree, in batches, through a cursor.
   *
   * ⚠️ Use this, not `loadIssuedProperties()`. The load-everything version is
   * 5–7 GB of Node heap at 2.5 million parcels (blocker S5 of D72); a cursor
   * keeps memory constant however large the registry grows.
   *
   * ⚠️ Ordered by `id` (the autoincrement key), NEVER by `propertyId`. That
   * column is a `String`, so Postgres orders it lexicographically ("10" before
   * "2") and a cursor over it would silently skip plots. Batch order does not
   * matter: both `buildTree()` and `applyLeafUpdates()` are independent of
   * input order (D41), which is what makes paging by an unrelated key safe.
   */
  async *streamIssuedProperties(batchSize = 5_000): AsyncGenerator<Property[]> {
    let cursor: number | undefined;

    for (;;) {
      const batch = await this.prisma.property.findMany({
        where: { status: 'ISSUED' },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      });
      if (batch.length === 0) return;

      yield batch;
      cursor = batch[batch.length - 1].id;
    }
  }

  /**
   * Build a tree from an explicit property list, entirely in memory.
   *
   * ⚠️ Reference implementation only — tests, and `NodeStoreService.bootstrap()`
   * at small N. At 2.5 million parcels this is ~10 million Poseidon calls and
   * ~1 GB of Maps. Re-sorts, so callers cannot accidentally supply a different
   * leaf order.
   */
  async buildFrom(
    properties: Property[],
  ): Promise<{ tree: LURMerkleTree; properties: Property[] }> {
    const ordered = sortByPropertyId(properties);
    return { tree: await buildTree(ordered.map(toLURRecord)), properties: ordered };
  }

  /** Merkle proof for one property against a tree already built. */
  async proofFor(tree: LURMerkleTree, property: Property): Promise<MerkleProofData> {
    return generateMerkleProof(tree, toLURRecord(property));
  }
}

/**
 * Canonical list order (D41 — no longer the leaf order): ascending numeric
 * propertyId. Exported so the regression test can exercise it directly.
 */
export function sortByPropertyId<T extends { propertyId: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const left = BigInt(a.propertyId);
    const right = BigInt(b.propertyId);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
}
