import { Module } from '@nestjs/common';

import { ArchiveService } from './archive.service';
import { ChainModule } from '../chain/chain.module';
import { IssuanceRequestService } from './issuance-request.service';
import { IssuanceService } from './issuance.service';
import { IssuerService } from './issuer.service';
import { LineageModule } from '../lineage/lineage.module';
import { PdfService } from './pdf.service';
import { ZipService } from './zip.service';

/**
 * IssuanceModule — builds an owner bundle (D31 §3.1: receipt, secret, PDF, ZIP) stamped with
 * the issuer identity block (D30), and queues issuance requests (D87). Issuances are published
 * by the change-set round (D84), which also builds the per-office archives.
 */
@Module({
  imports: [ChainModule, LineageModule],
  providers: [
    IssuanceService,
    IssuerService,
    PdfService,
    ZipService,
    ArchiveService,
    IssuanceRequestService,
  ],
  exports: [IssuanceService, IssuerService, IssuanceRequestService, ArchiveService],
})
export class IssuanceModule {}
