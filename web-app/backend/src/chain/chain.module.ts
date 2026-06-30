import { Module } from '@nestjs/common';
import { ChainService } from './chain.service';

/**
 * ChainModule
 * Handles all Ethereum smart contract interactions.
 * Exports ChainService so other modules (RecordsModule) can call publishRoot() after updates.
 */
@Module({
  providers: [ChainService],
  exports: [ChainService],
})
export class ChainModule {}
