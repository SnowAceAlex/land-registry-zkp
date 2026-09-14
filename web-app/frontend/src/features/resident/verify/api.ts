/**
 * features/resident/verify/api.ts - UC-6 backend calls.
 *
 * TODO (Phase 9): type the body as VerifyProofDto and the result as
 * VerifyProofResponseDto (web-app/backend/src/proof/dto/). A rejected proof
 * comes back as 422 with `reason` (StaleTimestamp / InvalidProof / RootMismatch,
 * D33), not as `{ valid: false }` - apiFetch currently collapses that into a
 * generic Error, see the TODO in lib/api-client.ts.
 */
import { apiFetch } from '@/lib/api-client';

/** POST /api/proof/verify - off-chain verify; `onChain: true` also asks the contract. */
export async function verifyProofOnServer(proof: unknown): Promise<{ valid: boolean }> {
  return apiFetch<{ valid: boolean }>('/proof/verify', {
    method: 'POST',
    body: JSON.stringify(proof),
  });
}
