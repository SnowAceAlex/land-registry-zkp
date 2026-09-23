/**
 * features/resident/proof/api.ts - UC-5's only contact with the network.
 *
 * ⚠️ THE PRIVACY CONSTRAINT IS ENFORCED BY THE SHAPE OF THIS FILE. There is one
 *    function, it is a GET, and its only argument goes in the path. No function
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
 */
export async function refreshMerkleProof(propertyId: string): Promise<MerkleProofResponse> {
  return apiFetch<MerkleProofResponse>(`/proof/${propertyId}`);
}
