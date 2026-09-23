import { Injectable, NotFoundException } from '@nestjs/common';
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

  /** Build the tree that matches the current DB state. */
  async buildCurrentTree(): Promise<{ tree: LURMerkleTree; properties: Property[] }> {
    const properties = await this.loadIssuedProperties();
    const tree = await buildTree(properties.map(toLURRecord));
    return { tree, properties };
  }

  /**
   * Build a tree from an explicit property list — used by issuance, which must
   * include properties whose commitments exist only in memory (they are written
   * to the DB only after the root publishes successfully).
   * Re-sorts, so callers cannot accidentally supply a different leaf order.
   */
  async buildFrom(
    properties: Property[],
  ): Promise<{ tree: LURMerkleTree; properties: Property[] }> {
    const ordered = sortByPropertyId(properties);
    return { tree: await buildTree(ordered.map(toLURRecord)), properties: ordered };
  }

  /**
   * Build the tree that WOULD result if the given properties changed owner —
   * used by the transfer preview (D28 step 2) and re-derived at approval to
   * confirm the proof still commits to the root the registry would produce.
   * Nothing is persisted.
   *
   * @param replacements propertyId (decimal string) → new ownerCommitment (decimal string)
   * @returns the projected tree and the projected property rows, in leaf order
   */
  async buildProjectedTree(
    replacements: Map<string, string>,
  ): Promise<{ tree: LURMerkleTree; properties: Property[] }> {
    const current = await this.loadIssuedProperties();

    for (const propertyId of replacements.keys()) {
      if (!current.some((p) => p.propertyId === propertyId)) {
        throw new NotFoundException(
          `Property ${propertyId} is not an issued property — cannot project a transfer for it`,
        );
      }
    }

    // Only ownerCommitment may differ (transfer.circom derives both leaves from
    // one set of record-field signals — see D41/§2.4), so the projection swaps
    // that single field and leaves every leaf in its propertyId slot.
    const properties = current.map((property) => {
      const replacement = replacements.get(property.propertyId);
      return replacement === undefined ? property : { ...property, ownerCommitment: replacement };
    });

    return { tree: await buildTree(properties.map(toLURRecord)), properties };
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
