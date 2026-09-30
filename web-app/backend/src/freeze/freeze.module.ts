import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { FreezeService } from './freeze.service';

/**
 * FreezeModule — the on-chain freeze register as the backend reads it (D79/D80).
 * Own module because both TransfersModule and GovernmentModule gate on it.
 */
@Module({
  imports: [ChainModule],
  providers: [FreezeService],
  exports: [FreezeService],
})
export class FreezeModule {}
