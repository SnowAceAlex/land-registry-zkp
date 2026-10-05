/**
 * features/resident/proof/api.ts - UC-5's only contact with the network.
 *
 * ⚠️ THE PRIVACY CONSTRAINT IS ENFORCED BY THE SHAPE OF THIS FILE. Both
 *    functions are GETs whose only argument goes in the path. No function
 *    here takes a body, so there is no call site through which a witness could
 *    leave the page even by mistake. `ownerSecret` and the record fields stay
 *    in the browser; only a finished proof and its public signals ever travel,
 *    and on this screen they travel only as a file the owner downloads.
 *
 * Note what is deliberately absent: there is no verify call. The owner's own
 * browser is the prover, and the verifier's browser is the verifier (D62).
 *
 * The route is unguarded (D39): the caller is a land owner, authenticating one
 * is circular here, and the response is Poseidon hashes that
 * `GET /api/records/:propertyId` already exposes.
 */

import { apiFetch } from '@/lib/api-client';
import type { AttestationStaple } from '@land-registry/blockchain/shared/statusAttestation';

/** GET /api/proof/:propertyId — MerkleProofResponseDto. */
export interface MerkleProofResponse {
  propertyId: string;
  leaf: string;
  merkleRoot: string;
  /** null when `inSync` is false: an unpublished tree has no version yet. */
  rootVersion: number | null;
  /** One sibling per level, leaf → root. Always TREE_DEPTH long. */
  siblings: string[];
  /** 0 = the running node is the left input at this level, 1 = the right. */
  pathIndices: number[];
  /** RootRegistry, as the backend resolves it. */
  contractAddress: string;
  onChain: { root: string; version: number };
  inSync: boolean;
  /** The tree is stored, so a proof always comes out of the node table (D72). */
  source: 'nodes';
}

/**
 * Re-issue the current Merkle proof for a plot.
 *
 * Not optional, and not an optimisation: EVERY published root invalidates the
 * proof inside every issued bundle, not just the plot that changed — one leaf
 * moving alters every node on its path, and every other leaf has a sibling on
 * that path. So a receipt goes stale when a stranger transfers their plot, and
 * proving from the receipt's own path would produce a proof every verifier
 * rejects with RootMismatch.
 *
 * `cache: 'no-cache'` lets the browser keep the last answer and ask the
 * registry whether it still holds (If-None-Match → 304, D74): measured at
 * ~690 req/s against ~200 for a full answer, and the 304 needs no RPC call.
 * Never `'default'` — that would serve a cached proof for up to 60 s without
 * asking, and after a publish this page would compare a superseded root with
 * the chain's and report the registry as behind. The backend sends no ETag on
 * an out-of-sync answer, so that one is never kept at all.
 */
export async function refreshMerkleProof(propertyId: string): Promise<MerkleProofResponse> {
  return apiFetch<MerkleProofResponse>(`/proof/${propertyId}`, { cache: 'no-cache' });
}

/** GET /api/proof/:propertyId/attestation — AttestationResponseDto (D82). */
export interface AttestationResponse extends AttestationStaple {
  propertyId: string;
  ownerCommitment: string;
  merkleRoot: string;
  attester: string;
  chainId: number;
  verifyingContract: string;
}

/**
 * The registry's signed "no open procedure" note, stapled into proof.json
 * (D82). 409 ProcedureOpen while a transfer or revocation is open. Never
 * cached: it follows the plot's procedures, not the root.
 */
export async function fetchAttestation(propertyId: string): Promise<AttestationResponse> {
  return apiFetch<AttestationResponse>(`/proof/${propertyId}/attestation`, { cache: 'no-store' });
}
