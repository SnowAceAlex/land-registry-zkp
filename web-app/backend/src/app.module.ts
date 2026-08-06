import { Module } from '@nestjs/common';
import { ChainModule } from './chain/chain.module';
import { GovernmentModule } from './government/government.module';
import { IssuanceModule } from './issuance/issuance.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProofModule } from './proof/proof.module';
import { RecordsModule } from './records/records.module';
import { TreeModule } from './tree/tree.module';

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
    TreeModule,
    ChainModule,
    IssuanceModule,
    GovernmentModule,
    RecordsModule,
    ProofModule,
  ],
})
export class AppModule {}
