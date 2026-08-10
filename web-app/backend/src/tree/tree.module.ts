import { Module } from '@nestjs/common';
import { TreeService } from './tree.service';

/**
 * TreeModule
 * ─────────────────────────────────────────────────────────────────────────────
 * Owns the canonical leaf ordering (D24) and is the only module that builds
 * Merkle trees from DB state. Government, issuance and proof modules import
 * it rather than rebuilding trees themselves — two different orderings would
 * produce two different roots.
 *
 * PrismaService comes from the @Global PrismaModule, so no import is needed.
 */
@Module({
  providers: [TreeService],
  exports: [TreeService],
})
export class TreeModule {}
