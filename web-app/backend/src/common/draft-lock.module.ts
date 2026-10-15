import { Module } from '@nestjs/common';

import { DraftLockService } from './draft-lock.service';

/**
 * DraftLockModule
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides the DraftLockService, which ensures at most one open ChangeSet
 * draft exists (D44).
 *
 * PrismaService comes from the @Global PrismaModule, so no import is needed.
 */
@Module({
  providers: [DraftLockService],
  exports: [DraftLockService],
})
export class DraftLockModule {}
