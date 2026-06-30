import { Injectable } from '@nestjs/common';
import { RecordsService } from '../records/records.service';

/**
 * ProofService
 * ─────────────────────────────────────────────────────────────────────────────
 * Issues Merkle proofs to authorized land owners (privacy-preserving).
 *
 * A Merkle proof allows the owner to prove that their record is part of the
 * official registry (published Merkle root on-chain) without revealing other
 * records or their private identity.
 *
 * TODO:
 *  1. Import merkle tree functions from @land-registry/blockchain/shared:
 *     import { buildTree, generateMerkleProof, hashRecord } from '@land-registry/blockchain/shared';
 *
 *  2. Implement generateProof(propertyId: string): MerkleProofData
 *     Steps:
 *       a. Fetch ALL Property records from RecordsService (needed to rebuild the full tree)
 *       b. Convert each DB record to a LURRecord (string → BigInt conversions)
 *       c. Build the Merkle tree: const tree = await buildTree(lurRecords)
 *       d. Find the target record by propertyId
 *       e. Generate proof: const proof = await generateMerkleProof(tree, targetRecord)
 *       f. Return the MerkleProofData (siblings + pathIndices + root + leaf)
 *
 *  3. Implement verifyProof(proof: MerkleProofData): boolean
 *     Use verifyMerkleProof() from @land-registry/blockchain/shared for off-chain check.
 *     Optionally cross-check the root against the on-chain latestRoot via ChainService.
 *
 *  4. Consider caching the Merkle tree (in-memory or Redis) to avoid rebuilding on
 *     every proof request — only invalidate when records change.
 *
 * SECURITY NOTE:
 *   The backend should authenticate the caller before issuing a proof.
 *   Only the property owner (verified by signature or JWT) should get their proof.
 */
@Injectable()
export class ProofService {
  constructor(private readonly recordsService: RecordsService) {}

  async generateProof(_propertyId: string) {
    // TODO: implement
    // See steps 1-5 in the class docstring above
    throw new Error('generateProof not implemented yet');
  }

  async verifyProof(_proof: unknown) {
    // TODO: implement off-chain verification
    throw new Error('verifyProof not implemented yet');
  }
}
