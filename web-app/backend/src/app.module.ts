import { Module } from '@nestjs/common';
import { RecordsModule } from './records/records.module';
import { ProofModule } from './proof/proof.module';
import { ChainModule } from './chain/chain.module';

/**
 * Root application module.
 * Imports all feature modules.
 *
 * TODO: Add PrismaModule (a global module wrapping PrismaClient) so all
 *       services can inject PrismaService without re-importing PrismaModule.
 *       Example: create src/prisma/prisma.module.ts + prisma.service.ts
 */
@Module({
  imports: [
    RecordsModule,
    ProofModule,
    ChainModule,
  ],
})
export class AppModule {}
