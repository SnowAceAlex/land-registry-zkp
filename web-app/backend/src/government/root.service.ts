import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Property } from '@prisma/client';
import { LURMerkleTree, generateMerkleProof } from '@land-registry/blockchain/shared';

import { ChainService } from '../chain/chain.service';
import { PrismaService } from '../prisma/prisma.service';
import { TreeService } from '../tree/tree.service';
import { toLURRecord } from '../records/record.mapper';

/**
 * RootService
 * ─────────────────────────────────────────────────────────────────────────────
 * Owns the "publish a root and bring the cached proofs back in sync" step,
 * shared by issuance and transfer approval.
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: TreeService,
    private readonly chain: ChainService,
  ) {}

  /**
   * Rebuild from current DB state, publish, and refresh every cached proof.
   * Used after manual record edits and as the recovery path when an issuance
   * batch published a root its DB write never caught up with.
   *
   * When the rebuilt root already equals the on-chain one there is nothing to
   * publish: the contract rejects that with DuplicateRoot (D33), and sending
   * the transaction anyway would turn a perfectly normal "already in sync" into
   * an error. The proof cache is still refreshed, since that is the other half
   * of what a caller pressing this button wants.
   */
  async rebuildAndPublish(): Promise<{
    root: bigint;
    version: number;
    txHash: string | null;
    published: boolean;
  }> {
    const { tree, properties } = await this.tree.buildCurrentTree();
    const latestRoot = await this.chain.getLatestRoot();

    if (tree.root === latestRoot) {
      const version = await this.chain.getRootVersion();
      await this.prisma.$transaction(
        await this.proofCacheStatements(tree, properties, version),
      );
      this.logger.log(`root unchanged (version ${version}) — refreshed proof cache only`);
      return { root: tree.root, version, txHash: null, published: false };
    }

    const published = await this.chain.publishRoot(tree.root);

    await this.prisma.$transaction([
      this.recordRootStatement(published),
      ...(await this.proofCacheStatements(tree, properties, published.version)),
    ]);

    return { ...published, published: true };
  }

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
   * Logged when the chain has advanced but the matching DB write failed. The
   * two can be brought back together by calling the publish-root endpoint,
   * which republishes whatever the DB currently implies.
   */
  warnChainAheadOfDatabase(txHash: string, error: unknown): void {
    this.logger.error(
      `Root published on-chain (tx ${txHash}) but the database write failed: ` +
        `${(error as Error)?.message}. The DB and chain are out of sync — ` +
        `POST /api/government/publish-root to republish from current DB state.`,
    );
  }
}
