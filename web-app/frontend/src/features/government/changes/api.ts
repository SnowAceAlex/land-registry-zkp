/**
 * features/government/changes/api.ts - UC-4 backend calls (D44–D46, D56 + D73).
 *
 * A change set batches every approved transfer and up to `revocationCap`
 * pending revocations (150 since D73; the backend reports it with the queue)
 * into ONE new root. Same draft → sign → confirm shape as issuance; the draft
 * carries the revocation calldata to sign. Revocations are queued on the
 * Revocations page (features/government/revocations); the queue itself is read
 * through usePendingChanges() in the portal's api/hooks.
 */

import { govDelete, govDownload, govGet, govPost } from '../api/gov-client';
import type { ChangeSetDraftDetail, ChangeSetSummary, DraftConfirmation } from '../api/types';

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

/** Every change set, newest first — summary columns only (D77). */
export function listChangeSets(): Promise<ChangeSetSummary[]> {
  return govGet<ChangeSetSummary[]>('/government/changesets');
}

/** The buyers' bundles of one round, one folder per transferred plot (D77). */
export function downloadChangeSetArchive(id: number): Promise<string> {
  return govDownload(`/government/changesets/${id}/archive`);
}
