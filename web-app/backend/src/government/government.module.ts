import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { ChangeSetService } from './changeset.service';
import { DraftLockModule } from '../common/draft-lock.module';
import { GovernmentController } from './government.controller';
import { GovernmentService } from './government.service';
import { HistoryModule } from '../history/history.module';
import { ImportModule } from '../import/import.module';
import { IssuanceModule } from '../issuance/issuance.module';
import { LineageModule } from '../lineage/lineage.module';
import { OpenDraftService } from './open-draft.service';
import { RevocationService } from './revocation.service';
import { RootModule } from './root.module';
import { RoundArchiveBuilder } from './round-archive.builder';
import { RoundArchiveService } from './round-archive.service';
import { TreeModule } from '../tree/tree.module';

/**
 * GovernmentModule — the state authority portal (Phase 5).
 *
 * What is left in GovernmentService is the status and property-listing views.
 * CSV parsing, the statutory rules and the D28 transfer flow have their own
 * modules (ImportModule, LandLawModule, TransfersModule); issuance requests and
 * bundle building live in IssuanceModule.
 *
 * `GovernmentController` still owns every `/api/government/*` route: the split
 * is about where logic lives, not about changing the portal's API surface.
 *
 * RootService lives in its own RootModule (see its doc comment); RootModule is
 * re-exported so consumers that import GovernmentModule for RootService (e.g.
 * TransfersModule) keep working unchanged.
 *
 * ChangeSetService (D44/D46/D84) is provided directly here — nothing else needs
 * it. It needs TreeModule (project the root), DraftLockModule (at most one open
 * draft), HistoryModule
 * (PropertyEventService — records ISSUED/TRANSFERRED/REVOKED events) and
 * LineageModule (D90 re-check); ChainModule and RootModule are imported above.
 */
@Module({
  imports: [
    ChainModule,
    IssuanceModule,
    ImportModule,
    RootModule,
    TreeModule,
    HistoryModule,
    DraftLockModule,
    LineageModule,
  ],
  controllers: [GovernmentController],
  providers: [
    GovernmentService,
    RevocationService,
    ChangeSetService,
    RoundArchiveBuilder,
    RoundArchiveService,
    OpenDraftService,
  ],
  exports: [RootModule],
})
export class GovernmentModule {}
