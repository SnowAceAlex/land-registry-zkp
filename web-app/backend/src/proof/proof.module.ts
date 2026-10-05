import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import { AttestationService } from './attestation.service';
import { TreeModule } from '../tree/tree.module';

/**
 * ProofModule — Merkle-proof refresh and off-chain verification for owners and
 * verifiers (Phase 6).
 *
 * TreeModule because a stale cache is rebuilt through the one service allowed
 * to decide leaf order (D24), ChainModule because both endpoints are answers
 * about the CURRENT root and neither means anything without it. PrismaModule is
 * @Global, so PrismaService needs no import here.
 */
@Module({
  imports: [TreeModule, ChainModule],
  controllers: [ProofController],
  providers: [ProofService, AttestationService],
})
export class ProofModule {}
