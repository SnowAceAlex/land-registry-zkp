import { Module } from '@nestjs/common';
import { ChainModule } from './chain/chain.module';
import { GovernmentModule } from './government/government.module';
import { ImportModule } from './import/import.module';
import { IssuanceModule } from './issuance/issuance.module';
import { LandLawModule } from './land-law/land-law.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProofModule } from './proof/proof.module';
import { RecordsModule } from './records/records.module';
import { TransfersModule } from './transfers/transfers.module';
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
    LandLawModule,
    ImportModule,
    IssuanceModule,
    GovernmentModule,
    TransfersModule,
    RecordsModule,
    ProofModule,
  ],
})
export class AppModule {}
