import { Module } from '@nestjs/common';

import { RootService } from './root.service';

/**
 * RootModule
 * ─────────────────────────────────────────────────────────────────────────────
 * RootService in its own module, separate from GovernmentModule.
 *
 * GovernmentModule imports IssuanceModule (for IssuanceService/IssuerService).
 * IssuanceModule's IssuanceBatchService (D43) also needs RootService — but
 * having IssuanceModule import GovernmentModule to reach it would close a
 * two-module cycle (GovernmentModule -> IssuanceModule -> GovernmentModule)
 * that only forwardRef() can break. Splitting RootService into its own module
 * removes the cycle instead of papering over it: both GovernmentModule and
 * IssuanceModule import RootModule directly, and neither depends on the other
 * for it.
 *
 * GovernmentModule re-exports RootModule so existing consumers (TransfersModule,
 * which imports GovernmentModule for RootService) keep working unchanged.
 *
 * PrismaService comes from the @Global PrismaModule, so no import is needed.
 * RootService no longer talks to the chain itself (D43) — callers pass it the
 * already-published {root, version, txHash}, so it needs neither ChainModule
 * nor TreeModule.
 */
@Module({
  providers: [RootService],
  exports: [RootService],
})
export class RootModule {}
