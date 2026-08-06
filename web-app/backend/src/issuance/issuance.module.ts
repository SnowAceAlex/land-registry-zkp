import { Module } from '@nestjs/common';

import { BundleClaimService } from './bundle-claim.service';
import { BundlesController } from './bundles.controller';
import { ChainModule } from '../chain/chain.module';
import { IssuanceService } from './issuance.service';
import { IssuerService } from './issuer.service';
import { PdfService } from './pdf.service';
import { ZipService } from './zip.service';

/**
 * IssuanceModule
 * ─────────────────────────────────────────────────────────────────────────────
 * The life of an owner bundle: build it (D31 §3.1 — receipt, secret, PDF, ZIP),
 * stamp it with the issuer identity block (D30), hold it under a one-time claim
 * token, and hand it over exactly once (D34).
 *
 * What is NOT here is WHEN bundles get built — GovernmentModule decides that,
 * because issuing is an act of the state authority. The custody of the secret
 * afterwards is this module's, which is why the claim endpoint lives here and
 * is deliberately not behind the government API key.
 */
@Module({
  imports: [ChainModule],
  controllers: [BundlesController],
  providers: [BundleClaimService, IssuanceService, IssuerService, PdfService, ZipService],
  exports: [BundleClaimService, IssuanceService, IssuerService],
})
export class IssuanceModule {}
