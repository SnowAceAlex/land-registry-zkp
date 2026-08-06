import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { GovernmentModule } from '../government/government.module';
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
 * Imports GovernmentModule for RootService, which owns "publish a root and bring
 * every cached proof back in sync" — shared with issuance because both end in
 * exactly that step.
 */
@Module({
  imports: [ChainModule, TreeModule, GovernmentModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
