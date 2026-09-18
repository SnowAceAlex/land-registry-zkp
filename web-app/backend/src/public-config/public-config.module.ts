import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { PublicConfigController } from './public-config.controller';
import { PublicConfigService } from './public-config.service';

/**
 * PublicConfigModule — the unguarded chain-identity route the logged-out
 * resident portal reads at page load (D58, Phase 9).
 *
 * ChainModule only: every value served is a getter on ChainService, which is
 * what guarantees the browser and the backend name the same two contracts.
 */
@Module({
  imports: [ChainModule],
  controllers: [PublicConfigController],
  providers: [PublicConfigService],
})
export class PublicConfigModule {}
