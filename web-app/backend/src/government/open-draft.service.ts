import { Injectable } from '@nestjs/common';

import { DraftLockService } from '../common/draft-lock.service';
import { IssuanceBatchService, IssuanceDraftDetail } from '../issuance/issuance-batch.service';
import { ChangeSetDraftDetail, ChangeSetService } from './changeset.service';

/**
 * OpenDraftService — `GET /api/government/drafts/open` (D53).
 *
 * The one-draft lock (D44) already knows WHICH draft is open; this turns that
 * into what a portal needs to act on it. Without it the government portal
 * could not honour the D43 promise that a draft survives a closed tab: the
 * create response is the only place the root to sign — and for a change set,
 * the revocation calldata — was ever returned.
 *
 * Wrapped as `{ draft }` rather than a bare `null`, because an empty body and a
 * JSON `null` are not handled consistently between Nest, Express and fetch().
 */
@Injectable()
export class OpenDraftService {
  constructor(
    private readonly lock: DraftLockService,
    private readonly issuanceBatches: IssuanceBatchService,
    private readonly changeSets: ChangeSetService,
  ) {}

  async current(): Promise<{ draft: IssuanceDraftDetail | ChangeSetDraftDetail | null }> {
    const open = await this.lock.openDraft();
    if (!open) return { draft: null };

    const draft =
      open.kind === 'issuance'
        ? await this.issuanceBatches.draftDetail(open.id)
        : await this.changeSets.draftDetail(open.id);
    return { draft };
  }
}
