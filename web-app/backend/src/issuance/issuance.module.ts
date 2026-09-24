import { Module } from '@nestjs/common';

import { ArchiveService } from './archive.service';
import { ChainModule } from '../chain/chain.module';
import { DraftLockModule } from '../common/draft-lock.module';
import { HistoryModule } from '../history/history.module';
import { IssuanceBatchService } from './issuance-batch.service';
import { IssuanceService } from './issuance.service';
import { IssuerService } from './issuer.service';
import { PdfService } from './pdf.service';
import { RootModule } from '../government/root.module';
import { TreeModule } from '../tree/tree.module';
import { ZipService } from './zip.service';

/**
 * IssuanceModule
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds an owner bundle (D31 §3.1 — receipt, secret, PDF, ZIP) and stamps it
 * with the issuer identity block (D30).
 *
 * The one-time claim custody this module used to own (D34's per-owner
 * claim-link service and controller, both now deleted) is gone, superseded by
 * the D42 fallback: the government downloads one archive per issuance batch
 * instead of each owner claiming their own. ArchiveService builds that archive
 * and IssuanceBatchService.confirm() persists it — see archive.service.ts.
 *
 * IssuanceBatchService (D43) is the two-phase draft/confirm/discard flow that
 * replaces issueBatch()'s "publish then write" ordering. It needs TreeModule
 * (project the root), ChainModule (read latestRoot at confirm time),
 * HistoryModule (PropertyEventService — records ISSUED events) and
 * DraftLockModule (at most one open draft, D44), plus RootModule for
 * RootService — imported from its own module rather than via GovernmentModule
 * to avoid a cycle, since GovernmentModule imports IssuanceModule already.
 */
@Module({
  imports: [ChainModule, TreeModule, HistoryModule, DraftLockModule, RootModule],
  providers: [
    IssuanceService,
    IssuerService,
    PdfService,
    ZipService,
    ArchiveService,
    IssuanceBatchService,
  ],
  exports: [IssuanceService, IssuerService, IssuanceBatchService, ArchiveService],
})
export class IssuanceModule {}
