import { Module } from '@nestjs/common';

import { ChainModule } from '../chain/chain.module';
import { ChangeSetService } from './changeset.service';
import { DraftLockModule } from '../common/draft-lock.module';
import { GovernmentController } from './government.controller';
import { GovernmentService } from './government.service';
import { HistoryModule } from '../history/history.module';
import { ImportModule } from '../import/import.module';
import { IssuanceModule } from '../issuance/issuance.module';
import { OpenDraftService } from './open-draft.service';
import { RevocationService } from './revocation.service';
import { RootModule } from './root.module';
import { TreeModule } from '../tree/tree.module';

/**
 * GovernmentModule — the state authority portal (Phase 5).
 *
 * What is left in GovernmentService after the Phase-5 split, and after the
 * backend-signed issue-batch/publish-root endpoints were removed (D43), is
 * just the status and property-listing views. The three concerns that used
 * to share this folder now have their own boundaries — ImportModule (CSV
 * parsing), LandLawModule (the statutory rules behind it), TransfersModule
 * (the D28 flow) — issuance lives in IssuanceModule (IssuanceBatchService,
 * the two-phase draft/confirm flow), and bundle custody moved there too.
 *
 * `GovernmentController` still owns every `/api/government/*` route, including
 * `POST /import` and the issuance-batch routes it delegates to
 * IssuanceBatchService: the split is about where logic lives, not about
 * changing the portal's API surface.
 *
 * RootService now lives in its own RootModule (see its doc comment) rather
 * than being provided here directly — IssuanceModule needs it too, and
 * importing GovernmentModule from IssuanceModule would close a cycle since
 * GovernmentModule already imports IssuanceModule. RootModule is re-exported
 * so existing consumers that import GovernmentModule for RootService (e.g.
 * TransfersModule) keep working unchanged.
 *
 * ChangeSetService (D44/D46) is provided directly here rather than from its
 * own module, unlike RootService — nothing else needs it, so there is no
 * cycle to avoid. It needs TreeModule (project the root), DraftLockModule (at
 * most one open draft, shared with IssuanceBatchService) and HistoryModule
 * (PropertyEventService — records TRANSFERRED/REVOKED events); ChainModule and
 * RootModule are already imported above.
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
  ],
  controllers: [GovernmentController],
  providers: [GovernmentService, RevocationService, ChangeSetService, OpenDraftService],
  exports: [RootModule],
})
export class GovernmentModule {}
