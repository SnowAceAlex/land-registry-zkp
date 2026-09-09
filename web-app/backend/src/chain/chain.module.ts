import { Module } from '@nestjs/common';
import { ChainService } from './chain.service';

/**
 * ChainModule
 * Handles all Ethereum smart contract reads (RootRegistry/LandRegistryVerifier).
 * Exports ChainService so other modules can read chain state and verify proofs;
 * it no longer sends any transaction — on-chain writes are signed in the
 * officer's browser wallet (D43).
 */
@Module({
  providers: [ChainService],
  exports: [ChainService],
})
export class ChainModule {}
