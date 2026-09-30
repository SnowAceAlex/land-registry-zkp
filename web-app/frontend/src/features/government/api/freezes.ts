// The freeze status of one plot (D80) — portal infra, shared by the counter,
// the revocation form, the transfer queue and the change-set queue.

import { govGet } from './gov-client';
import type { FreezeStatus } from './types';

/** GET /government/freezes/:propertyId — call before recording a transfer or a revocation. */
export function getFreezeStatus(propertyId: string): Promise<FreezeStatus> {
  return govGet<FreezeStatus>(`/government/freezes/${encodeURIComponent(propertyId)}`);
}
