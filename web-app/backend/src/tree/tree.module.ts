import { Module } from '@nestjs/common';
import { NodeStoreService } from './node-store.service';
import { TreeService } from './tree.service';

/**
 * TreeModule
 * ─────────────────────────────────────────────────────────────────────────────
 * The one module that speaks for the registry's Merkle tree. Government,
 * issuance, transfer and proof modules import it rather than building trees
 * themselves — two different builders would produce two different roots.
 *
 * Two services, split by what they know:
 *   - `NodeStoreService` — the tree as it is stored (D72). Proofs, projections
 *     and the statements that write a published round. This is what every
 *     runtime path should use.
 *   - `TreeService` — loading plots out of Postgres, plus `buildFrom()`, the
 *     build-it-all-in-memory reference used by tests and by bootstrap.
 *
 * PrismaService comes from the @Global PrismaModule, so no import is needed.
 */
@Module({
  providers: [TreeService, NodeStoreService],
  exports: [TreeService, NodeStoreService],
})
export class TreeModule {}
