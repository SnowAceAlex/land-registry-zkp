/** Backend calls of the operations page. */

import { govPost } from '../api/gov-client';

/** D92: marks a round's expired, never-downloaded archives as handled; their alert stops. */
export function acknowledgeArchiveExpiry(changeSetId: number): Promise<{ acknowledged: number }> {
  return govPost(`/government/changesets/${changeSetId}/archives/acknowledge-expiry`);
}
