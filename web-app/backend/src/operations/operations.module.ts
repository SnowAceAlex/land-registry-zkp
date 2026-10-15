import { Module } from '@nestjs/common';

import { OperationsController } from './operations.controller';
import { QueueService } from './queue.service';

// D87: the shared queue — list, hold, release, withdraw over all three procedures.
@Module({
  controllers: [OperationsController],
  providers: [QueueService],
})
export class OperationsModule {}
