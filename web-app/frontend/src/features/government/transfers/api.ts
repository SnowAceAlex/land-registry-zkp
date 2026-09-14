/**
 * features/government/transfers/api.ts - UC-3 backend calls.
 *
 * Every route here is officer-only (D47). What crosses the network is public
 * by design: a commitment, a proof and its public signals. The two secrets the
 * proof was built from never appear in any request below.
 */

import type { Groth16Proof, PublicSignals } from '@land-registry/blockchain/shared';

import { govDownload, govGet, govPost } from '../api/gov-client';
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

/** POST /transfers/preview — both Merkle paths for the witness (D28 step 2). */
export function previewTransfer(propertyId: string, newOwnerCommitment: string): Promise<TransferPreview> {
  return govPost<TransferPreview>('/transfers/preview', { propertyId, newOwnerCommitment });
}

/** POST /transfers — queue a proof for approval (D28 step 3). */
export function submitTransfer(body: {
  propertyId: string;
  newOwnerCommitment: string;
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

/** The new owner's receipt.json + certificate.pdf once PUBLISHED (D51). */
export function downloadBuyerBundle(id: number): Promise<string> {
  return govDownload(`/transfers/${id}/bundle`);
}
