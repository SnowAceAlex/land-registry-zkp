import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { GovernmentController } from './government.controller';
import { GovernmentService } from './government.service';
import { ImportModule } from '../import/import.module';
import { IssuanceModule } from '../issuance/issuance.module';
import { RootService } from './root.service';
import { TreeModule } from '../tree/tree.module';

/**
 * GovernmentModule — the state authority portal (Phase 5).
 *
 * What is left here after the Phase-5 split is the registry operations proper:
 * batch issuance, root publishing, and the status/listing views. The three
 * concerns that used to share this folder now have their own boundaries —
 * ImportModule (CSV parsing), LandLawModule (the statutory rules behind it),
 * TransfersModule (the D28 flow) — and bundle custody moved to IssuanceModule.
 *
 * `GovernmentController` still owns every `/api/government/*` route, including
 * `POST /import`: the split is about where logic lives, not about changing the
 * portal's API surface.
 *
 * Exports RootService because publishing a root and refreshing every cached
 * proof is the shared tail of both issuance and transfer approval.
 */
@Module({
  imports: [ChainModule, IssuanceModule, TreeModule, ImportModule],
  controllers: [GovernmentController],
  providers: [GovernmentService, RootService],
  exports: [RootService],
})
export class GovernmentModule {}
