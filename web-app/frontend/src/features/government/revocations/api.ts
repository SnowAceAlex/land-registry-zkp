/**
 * features/government/revocations/api.ts - queue a revocation (D45).
 *
 * The request only queues; the plot leaves the tree when the next round
 * publishes. Only keccak256(detailText) will reach the chain.
 */

import { govPost } from '../api/gov-client';
import type { QueueItem } from '../api/types';

export function requestRevocation(body: {
  propertyId: string;
  reasonCode: number;
  detailText: string;
}): Promise<{ id: number; propertyId: string; detailHash: string }> {
  return govPost('/government/revocations', body);
}

/** POST /government/queue/revocation/:id/withdraw — the plot's branch or a central office; unlocks the plot. */
export function withdrawRevocation(id: number): Promise<QueueItem> {
  return govPost<QueueItem>(`/government/queue/revocation/${id}/withdraw`);
}
