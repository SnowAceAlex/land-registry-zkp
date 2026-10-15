import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { DraftLockModule } from '../common/draft-lock.module';
import { ProofModule } from '../proof/proof.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { QueueService } from './queue.service';

// D87: the shared queue — list, hold, release, withdraw over all three procedures.
// D89: the overview also reads the chain and the attester address.
@Module({
  imports: [ChainModule, ProofModule, DraftLockModule],
  controllers: [OperationsController],
  providers: [QueueService, OperationsService],
})
export class OperationsModule {}
