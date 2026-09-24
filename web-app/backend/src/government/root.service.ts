import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * RootService
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors a published root into `merkle_roots`, and shouts when the chain has
 * moved ahead of the database. It sends no transaction (D43): the root is
 * signed in the officer's browser wallet, and the caller — see
 * IssuanceBatchService.confirm() and ChangeSetService.confirm() — hands the
 * resulting {root, version, txHash} to recordRootStatement() below.
 *
 * ⚠️ HISTORY WORTH KEEPING. This class used to rewrite the cached Merkle proof
 * of EVERY issued property after every publish, because altering one leaf
 * changes every node on its path and each other leaf has exactly one sibling on
 * that path. That is still true of the tree. What changed at D72 is that the
 * tree itself is stored, in `merkle_nodes`: "refresh every proof" is now
 * "write O(k·TREE_DEPTH) nodes", and each owner's proof is computed when they
 * ask for it. Do not reintroduce a proof cache here — at 2.5 million parcels it
 * was 4–5 GB rewritten per publish, inside a single transaction.
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
