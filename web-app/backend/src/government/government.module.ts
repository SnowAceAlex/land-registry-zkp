import { Module } from '@nestjs/common';

import { BundlesController } from './bundles.controller';
import { ChainModule } from '../chain/chain.module';
import { GovernmentController } from './government.controller';
import { GovernmentService } from './government.service';
import { ImportService } from './import.service';
import { AdministrativeUnitsService } from './administrative-units.service';
import { IssuanceModule } from '../issuance/issuance.module';
import { RootService } from './root.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { TreeModule } from '../tree/tree.module';

/**
 * GovernmentModule — the state authority portal (Phase 5).
 * Bulk import, batch issuance, root publishing, and the transfer approval
 * queue (D28). Bundle building lives in IssuanceModule; tree construction in
 * TreeModule.
 */
@Module({
  imports: [ChainModule, IssuanceModule, TreeModule],
  controllers: [GovernmentController, BundlesController, TransfersController],
  providers: [
    GovernmentService,
    ImportService,
    AdministrativeUnitsService,
    RootService,
    TransfersService,
  ],
  exports: [RootService],
})
export class GovernmentModule {}
