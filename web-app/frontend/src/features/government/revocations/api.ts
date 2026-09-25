/**
 * features/government/revocations/api.ts - queue a revocation (D45).
 *
 * The request only queues; the plot leaves the tree when the next change set
 * publishes. Only keccak256(detailText) will reach the chain.
 */

import { govPost } from '../api/gov-client';

export function requestRevocation(body: {
  propertyId: string;
  reasonCode: number;
  detailText: string;
}): Promise<{ id: number; propertyId: string; detailHash: string }> {
  return govPost('/government/revocations', body);
}
