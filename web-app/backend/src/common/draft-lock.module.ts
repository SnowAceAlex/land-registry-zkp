import { Module } from '@nestjs/common';

import { DraftLockService } from './draft-lock.service';

/**
 * DraftLockModule
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides the DraftLockService, which ensures at most one open draft exists
 * across both IssuanceBatch and ChangeSet types (D44).
 *
 * Lives in common/ because both IssuanceBatchService (in issuance/) and
 * ChangeSetService (in government/) depend on it, avoiding circular imports.
 *
 * PrismaService comes from the @Global PrismaModule, so no import is needed.
 */
@Module({
  providers: [DraftLockService],
  exports: [DraftLockService],
})
export class DraftLockModule {}
