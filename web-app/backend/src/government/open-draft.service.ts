import { Injectable } from '@nestjs/common';

import { DraftLockService } from '../common/draft-lock.service';
import { ChangeSetDraftDetail, ChangeSetService } from './changeset.service';

/**
 * OpenDraftService — `GET /api/government/drafts/open` (D53).
 *
 * The one-draft lock (D44) knows WHICH draft is open; this returns what a portal
 * needs to act on it, so a draft survives a closed tab (D43): the create response
 * is otherwise the only place the root to sign and the revocation calldata appear.
 *
 * Wrapped as `{ draft }` rather than a bare `null`, because an empty body and a
 * JSON `null` are not handled consistently between Nest, Express and fetch().
 */
@Injectable()
export class OpenDraftService {
  constructor(
    private readonly lock: DraftLockService,
    private readonly changeSets: ChangeSetService,
  ) {}

  async current(): Promise<{ draft: ChangeSetDraftDetail | null }> {
    const open = await this.lock.openDraft();
    if (!open) return { draft: null };
    return { draft: await this.changeSets.draftDetail(open.id) };
  }
}
