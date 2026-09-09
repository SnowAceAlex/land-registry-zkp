import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Property } from '@prisma/client';
import { LURMerkleTree, generateMerkleProof } from '@land-registry/blockchain/shared';

import { PrismaService } from '../prisma/prisma.service';
import { toLURRecord } from '../records/record.mapper';

/**
 * RootService
 * ─────────────────────────────────────────────────────────────────────────────
 * Owns the "record a published root and bring the cached proofs back in sync"
 * step, shared by issuance and (once the batched change-set flow lands) transfer
 * approval. It no longer sends the publish transaction itself (D43) — that is
 * now signed in the officer's browser and confirmed by the caller (see
 * IssuanceBatchService.confirm()), which then hands the resulting {root,
 * version, txHash} to recordRootStatement()/proofCacheStatements() below.
 *
 * ⚠️ Every published root invalidates EVERY cached Merkle proof, not just the
 * ones for records that changed: altering one leaf changes every node on its
 * path, and each other leaf has exactly one sibling on that path. So the
 * refresh below deliberately rewrites all issued properties — refreshing only
 * the batch would leave every other owner holding a proof that no longer
 * verifies.
 */
@Injectable()
export class RootService {
  private readonly logger = new Logger(RootService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Prisma statement that mirrors an on-chain root into merkle_roots. */
  recordRootStatement(published: { root: bigint; version: number; txHash: string }) {
    return this.prisma.merkleRoot.upsert({
      where: { version: published.version },
      create: {
        version: published.version,
        root: published.root.toString(),
        txHash: published.txHash,
      },
      update: { root: published.root.toString(), txHash: published.txHash },
    });
  }

  /**
   * Statements that rewrite the cached leaf + Merkle proof + rootVersion for
   * every property in the tree. Returned rather than executed so the caller can
   * run them inside a larger transaction alongside its own writes.
   */
  async proofCacheStatements(
    tree: LURMerkleTree,
    properties: Property[],
    rootVersion: number,
  ): Promise<Prisma.PrismaPromise<unknown>[]> {
    const statements: Prisma.PrismaPromise<unknown>[] = [];

    for (const property of properties) {
      const proof = await generateMerkleProof(tree, toLURRecord(property));
      statements.push(
        this.prisma.property.update({
          where: { propertyId: property.propertyId },
          data: {
            leaf: proof.leaf.toString(),
            merkleProof: {
              siblings: proof.siblings.map((s) => s.toString()),
              pathIndices: proof.pathIndices,
            },
            rootVersion,
          },
        }),
      );
    }

    return statements;
  }

  /**
   * Logged when the chain has advanced but the matching DB write failed,
   * leaving the database behind whatever was just published on-chain.
   */
  warnChainAheadOfDatabase(txHash: string, error: unknown): void {
    this.logger.error(
      `Root published on-chain (tx ${txHash}) but the database write failed: ` +
        `${(error as Error)?.message}. The DB and chain are now out of sync and need manual reconciliation.`,
    );
  }
}
