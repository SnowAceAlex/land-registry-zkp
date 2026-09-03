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
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Every issued property, in the canonical list order (D41: no longer the leaf order).
   * Properties without an ownerCommitment are not yet issued and have no leaf.
   */
  async loadIssuedProperties(): Promise<Property[]> {
    const properties = await this.prisma.property.findMany({
      where: { ownerCommitment: { not: null } },
    });
    return sortByPropertyId(properties);
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
