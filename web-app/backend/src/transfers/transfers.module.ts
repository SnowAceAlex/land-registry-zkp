import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { TreeModule } from '../tree/tree.module';

/**
 * TransfersModule — the four-step transfer flow of D28.
 *
 * A domain in its own right, not a corner of the government portal: it has its
 * own table, its own lifecycle (pending → approved/rejected), and an access
 * split the rest of the portal does not share — preview and submit are public
 * because computing a projected root reveals nothing and needs no judgement,
 * while approval is deliberately a human at the authority.
 *
 * Approval no longer publishes a root (D46): it records the officer's decision and
 * the change goes on chain later, batched into a ChangeSet. That is why this module
 * no longer needs GovernmentModule/RootService.
 */
@Module({
  imports: [ChainModule, TreeModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
