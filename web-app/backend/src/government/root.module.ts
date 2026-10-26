import { Module } from '@nestjs/common';

import { RootService } from './root.service';

/**
 * RootModule
 * ─────────────────────────────────────────────────────────────────────────────
 * RootService in its own module, separate from GovernmentModule, so a module
 * that needs it can import it without importing GovernmentModule (which imports
 * IssuanceModule) and closing a cycle.
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
