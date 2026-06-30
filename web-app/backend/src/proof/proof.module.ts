import { Module } from '@nestjs/common';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import { RecordsModule } from '../records/records.module';

/**
 * ProofModule
 * Handles Merkle proof generation requests from land owners.
 * Depends on RecordsModule to fetch property records.
 *
 * TODO: Import ChainModule (or inject ChainService) if on-chain root verification
 *       is needed before issuing proofs.
 */
@Module({
  imports: [RecordsModule],
  controllers: [ProofController],
  providers: [ProofService],
})
export class ProofModule {}
