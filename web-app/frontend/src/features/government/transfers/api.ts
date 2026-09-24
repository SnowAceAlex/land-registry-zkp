/**
 * features/government/transfers/api.ts - UC-3 backend calls.
 *
 * Every route here is officer-only (D47). The seller's secret never appears in
 * any request below. The buyer's does, by design (D77): the registry issues it
 * in the preview, exactly like an issuance round's secret, and it comes back
 * with the proof so the change set's archive can deliver it to the buyer.
 */

import type { Groth16Proof, PublicSignals } from '@land-registry/blockchain/shared';

import { govGet, govPost } from '../api/gov-client';
import type {
  PropertyDetail,
  TransferPreview,
  TransferRequest,
  TransferStatus,
} from '../api/types';

/** GET /government/properties/:propertyId — the guarded full row (D50). */
export function getPropertyDetail(propertyId: string): Promise<PropertyDetail> {
  return govGet<PropertyDetail>(`/government/properties/${encodeURIComponent(propertyId)}`);
}

/** POST /transfers/preview — both Merkle paths and the buyer's new secret (D28 step 2, D77). */
export function previewTransfer(propertyId: string): Promise<TransferPreview> {
  return govPost<TransferPreview>('/transfers/preview', { propertyId });
}

/** POST /transfers — queue a proof for approval (D28 step 3). */
export function submitTransfer(body: {
  propertyId: string;
  newOwnerCommitment: string;
  newOwnerSecret: string;
  proof: Groth16Proof;
  publicSignals: PublicSignals;
}): Promise<TransferRequest> {
  return govPost<TransferRequest>('/transfers', body);
}

export function listTransfers(status: TransferStatus): Promise<TransferRequest[]> {
  return govGet<TransferRequest[]>(`/transfers?status=${status}`);
}

/** Verifies on chain and moves PENDING → APPROVED; publishes nothing (D46). */
export function approveTransfer(id: number): Promise<{ id: number; status: TransferStatus }> {
  return govPost(`/transfers/${id}/approve`);
}

export function rejectTransfer(id: number, reason?: string): Promise<TransferRequest> {
  return govPost<TransferRequest>(`/transfers/${id}/reject`, reason ? { reason } : {});
}
