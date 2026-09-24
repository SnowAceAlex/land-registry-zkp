/**
 * features/government/changes/api.ts - UC-4 backend calls (D44–D46, D56 + D73).
 *
 * A change set batches every approved transfer and up to `revocationCap`
 * pending revocations (150 since D73; the backend reports it with the queue)
 * into ONE new root. Same draft → sign → confirm shape as issuance; the draft
 * carries the revocation calldata to sign.
 */

import { govDelete, govDownload, govGet, govPost } from '../api/gov-client';
import type {
  ChangeSetDraftDetail,
  ChangeSetSummary,
  DraftConfirmation,
  PendingChanges,
} from '../api/types';

export function getPendingChanges(): Promise<PendingChanges> {
  return govGet<PendingChanges>('/government/pending-changes');
}

/** Queue a revocation; only keccak256(detailText) will reach the chain (D45). */
export function requestRevocation(body: {
  propertyId: string;
  reasonCode: number;
  detailText: string;
}): Promise<{ id: number; propertyId: string; detailHash: string }> {
  return govPost('/government/revocations', body);
}

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
