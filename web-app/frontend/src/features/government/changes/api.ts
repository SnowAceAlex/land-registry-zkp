/** Backend calls of the closing session: draft, confirm, discard a round; hold, release an item (D84, D87). */

import { govDelete, govPost } from '../api/gov-client';
import type {
  ChangeSetDraftDetail,
  DraftConfirmation,
  QueueItem,
  QueueKind,
} from '../api/types';

export function createChangeSetDraft(): Promise<ChangeSetDraftDetail> {
  return govPost<ChangeSetDraftDetail>('/government/changesets');
}

/** `txHash` is a label for history rows only — confirm decides from the chain. */
export function confirmChangeSetDraft(id: number, txHash?: string): Promise<DraftConfirmation> {
  return govPost<DraftConfirmation>(`/government/changesets/${id}/confirm`, txHash ? { txHash } : {});
}

export function discardChangeSetDraft(id: number): Promise<{ discarded: number }> {
  return govDelete<{ discarded: number }>(`/government/changesets/${id}`);
}

/** Keeps an open item out of the next round; it stays an open procedure (D87). */
export function holdQueueItem(kind: QueueKind, id: number, reason: string): Promise<QueueItem> {
  return govPost<QueueItem>(`/government/queue/${kind}/${id}/hold`, { reason });
}

export function releaseQueueItem(kind: QueueKind, id: number): Promise<QueueItem> {
  return govPost<QueueItem>(`/government/queue/${kind}/${id}/release`);
}
