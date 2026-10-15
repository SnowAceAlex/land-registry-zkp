/**
 * features/government/issuance/api.ts - UC-1 backend calls.
 *
 * Issuance is a queued request now (D87): the backend generates the owner
 * secrets and keeps them on the request, and the plot reaches the register in
 * the next round (D84), which the publishing page signs.
 */

import { govGet, govPost } from '../api/gov-client';
import type { IssuanceRequest, PropertyList, QueueItem } from '../api/types';

export const ISSUANCE_PAGE_SIZE = 50;

/** GET /government/properties?status=IMPORTED — the issuable plots, one page. */
export function listImportedProperties(skip: number): Promise<PropertyList> {
  return govGet<PropertyList>(
    `/government/properties?status=IMPORTED&skip=${skip}&take=${ISSUANCE_PAGE_SIZE}`,
  );
}

/** POST /government/issuance-requests — central only; 409 PredecessorNotRevoked (D90). */
export function requestIssuance(propertyIds: string[]): Promise<IssuanceRequest[]> {
  return govPost<IssuanceRequest[]>('/government/issuance-requests', { propertyIds });
}

/** GET /government/issuance-requests?status= — requests of one state, oldest first. */
export function listIssuanceRequests(
  status: 'READY' | 'PUBLISHED' | 'WITHDRAWN',
): Promise<IssuanceRequest[]> {
  return govGet<IssuanceRequest[]>(`/government/issuance-requests?status=${status}`);
}

/** POST /government/queue/issuance/:id/withdraw — discards the owner secret; the plot is IMPORTED again. */
export function withdrawIssuance(id: number): Promise<QueueItem> {
  return govPost<QueueItem>(`/government/queue/issuance/${id}/withdraw`);
}
