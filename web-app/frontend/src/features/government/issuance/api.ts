/**
 * features/government/issuance/api.ts - UC-1 backend calls (D43).
 *
 * Draft → (wallet signs, in DraftPanel) → confirm. The draft generates the
 * owner secrets and stores them durably without touching any Property row;
 * confirm re-reads latestRoot from the chain before writing anything.
 */

import { govDelete, govDownload, govGet, govPost } from '../api/gov-client';
import type {
  DraftConfirmation,
  IssuanceBatchSummary,
  IssuanceDraftDetail,
  PropertyList,
} from '../api/types';

export const ISSUANCE_PAGE_SIZE = 50;

/** GET /government/properties?status=IMPORTED — the issuable plots, one page. */
export function listImportedProperties(skip: number): Promise<PropertyList> {
  return govGet<PropertyList>(
    `/government/properties?status=IMPORTED&skip=${skip}&take=${ISSUANCE_PAGE_SIZE}`,
  );
}

export function listIssuanceBatches(): Promise<IssuanceBatchSummary[]> {
  return govGet<IssuanceBatchSummary[]>('/government/issuance-batches');
}

export function createIssuanceDraft(propertyIds: string[]): Promise<IssuanceDraftDetail> {
  return govPost<IssuanceDraftDetail>('/government/issuance-batches', { propertyIds });
}

/** `txHash` is a label for history rows only — confirm decides from the chain. */
export function confirmIssuanceDraft(id: number, txHash?: string): Promise<DraftConfirmation> {
  return govPost<DraftConfirmation>(
    `/government/issuance-batches/${id}/confirm`,
    txHash ? { txHash } : {},
  );
}

export function discardIssuanceDraft(id: number): Promise<{ discarded: number }> {
  return govDelete<{ discarded: number }>(`/government/issuance-batches/${id}`);
}

/** One ZIP for the round, a folder per plot (D42). 410 once the 7-day TTL passed. */
export function downloadIssuanceArchive(id: number): Promise<string> {
  return govDownload(`/government/issuance-batches/${id}/archive`);
}
