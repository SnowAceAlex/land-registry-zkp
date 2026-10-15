/**
 * features/government/changes/api.ts - the closing session's backend calls (D84, D87).
 *
 * One round batches everything open: issuance requests, approved transfers and
 * up to `revocationCap` pending revocations (D56 + D73; the backend reports the
 * cap with the queue) into ONE new root. Same draft → sign → confirm shape as
 * ever; the draft carries the revocation calldata to sign. What goes into the
 * round is read through usePendingChanges() / useQueue() in the portal's api/hooks.
 */

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
