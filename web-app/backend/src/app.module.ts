import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RecordsModule } from './records/records.module';
import { ProofModule } from './proof/proof.module';
import { ChainModule } from './chain/chain.module';

/**
 * Root application module.
 * Imports all feature modules.
 *
 * PrismaModule is @Global(), so PrismaService is available everywhere
 * without re-importing PrismaModule in each feature module.
 */
@Module({
  imports: [
    PrismaModule,
    RecordsModule,
    ProofModule,
    ChainModule,
  ],
})
export class AppModule {}
