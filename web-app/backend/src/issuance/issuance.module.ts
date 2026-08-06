import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { IssuanceService } from './issuance.service';
import { IssuerService } from './issuer.service';
import { PdfService } from './pdf.service';
import { ZipService } from './zip.service';

/**
 * IssuanceModule
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds owner bundles (D31 §3.1) — receipt, secret, PDF, ZIP — plus the
 * issuer identity block (D30). Distribution is NOT here: GovernmentModule
 * decides how bundles reach owners.
 */
@Module({
  imports: [ChainModule],
  providers: [IssuanceService, IssuerService, PdfService, ZipService],
  exports: [IssuanceService, IssuerService],
})
export class IssuanceModule {}
