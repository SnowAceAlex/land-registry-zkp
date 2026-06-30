import { Module } from '@nestjs/common';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';

/**
 * RecordsModule
 * Handles CRUD operations for Land Use Rights (LUR) records.
 *
 * TODO: Import PrismaModule here (or use a global PrismaModule) to inject PrismaService.
 */
@Module({
  controllers: [RecordsController],
  providers: [RecordsService],
  exports: [RecordsService], // Export so ChainModule / ProofModule can use it if needed
})
export class RecordsModule {}
