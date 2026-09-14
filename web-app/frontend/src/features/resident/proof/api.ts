/**
 * features/resident/proof/api.ts - UC-5 backend calls.
 *
 * Only public data crosses this boundary. The private witness (ownerSecret,
 * the full record) never goes into a request from this feature.
 *
 * TODO (Phase 9): replace `unknown` with MerkleProofResponseDto
 * (web-app/backend/src/proof/dto/proof.response.dto.ts). Compare its
 * `rootVersion` with the one in receipt.json to detect a stale bundle.
 */
import { apiFetch } from '@/lib/api-client';

/** GET /api/proof/:propertyId - re-issues the current Merkle proof (D40). */
export async function requestProof(propertyId: string): Promise<unknown> {
  return apiFetch<unknown>(`/proof/${propertyId}`);
}
