import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Property } from '@prisma/client';
import {
  CircuitType,
  Groth16Proof,
  PublicSignals,
  assertProofFresh,
  circuitTypeForSignalCount,
  describePublicSignals,
  getCircuitPaths,
  publicSignalIndex,
  rootSignalName,
  verifyGroth16Proof,
} from '@land-registry/blockchain/shared';

import { ChainService, ProofRejectedError } from '../chain/chain.service';
import { blockchainDir } from '../common/paths';
import { PrismaService } from '../prisma/prisma.service';
import { NodeStoreService } from '../tree/node-store.service';
import { proofETag } from './proof-etag';
import { VerifyProofDto } from './dto/proof.dto';
import { MerkleProofResponseDto, VerifyProofResponseDto } from './dto/proof.response.dto';

/**
 * ProofService — the owner-facing half of the registry (Phase 6).
 *
 * WHY THIS EXISTS AT ALL. Publishing a root invalidates the Merkle proof in
 * EVERY issued bundle, not just the ones whose records changed: altering one
 * leaf changes every node on its path, and each other leaf has exactly one
 * sibling on that path. So one transfer today makes the bundles of all N−1
 * other owners unusable. Without a way to fetch a refreshed proof, the system
 * stops working after its first transfer — this is a precondition, not a
 * convenience.
 *
 * WHAT IT DELIBERATELY DOES NOT NEED. Refreshing a proof requires no
 * `ownerSecret` and no private field: siblings and leaves are Poseidon hashes,
 * and the position in the tree follows from the pinned propertyId order (D24).
 * The owner's witness never comes near this service — it stays in their
 * browser, which is the whole privacy argument (Phase 8).
 */
@Injectable()
export class ProofService {
  private readonly logger = new Logger(ProofService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeStoreService,
    private readonly chain: ChainService,
  ) {}

  /**
   * The current Merkle proof for one property (D72 — supersedes D40).
   *
   * There is no cache left to go stale, and no rebuild path to fall into: the
   * tree lives in `merkle_nodes`, so a proof is exactly TREE_DEPTH key lookups.
   * That is what let this route drop its own throttle bucket (D74), and it is
   * the "server load" number Chapter 5 reports.
   *
   * WHAT IT STILL DELIBERATELY DOES NOT NEED. No `ownerSecret` and no private
   * field: siblings and leaves are Poseidon hashes, and the position follows
   * from the propertyId (D41). The owner witness never comes near this service.
   */
  async getMerkleProof(propertyId: string): Promise<MerkleProofResponseDto> {
    return this.buildProofResponse(await this.requireIssuedProperty(propertyId));
  }

  /** The proof response for a plot already known to be issued. */
  private async buildProofResponse(property: Property): Promise<MerkleProofResponseDto> {
    const propertyId = property.propertyId;

    const [latestRoot, onChainVersion, storedRoot] = await Promise.all([
      this.chain.getLatestRoot(),
      this.chain.getRootVersion(),
      this.nodes.rootNow(),
    ]);

    const proof = await this.nodes.proofFor(property);

    // A real check, not a ritual: `proof.root` is climbed UP from the leaf
    // through the stored siblings, while `storedRoot` is the stored root node —
    // two independent paths through the same table. A mismatch means the table
    // was written partially, and handing out a proof this service can already
    // tell is broken would surface only when the owner fails to prove.
    if (proof.root !== storedRoot) {
      throw new ServiceUnavailableException(
        `The Merkle path for property ${propertyId} climbs to ${proof.root}, but the stored ` +
          `root is ${storedRoot}. The node table is inconsistent — run tree:bootstrap.`,
      );
    }

    const inSync = proof.root === latestRoot;
    if (!inSync) {
      this.logger.warn(
        `proof for property ${propertyId} was built against root ${proof.root}, but the chain ` +
          `holds ${latestRoot} (version ${onChainVersion}) — the database has unpublished changes`,
      );
    }

    return {
      propertyId: property.propertyId,
      leaf: proof.leaf.toString(),
      merkleRoot: proof.root.toString(),
      // A root that is not the chain's has no version yet, and inventing one
      // would put a number in a refreshed receipt that means nothing on-chain.
      rootVersion: inSync ? onChainVersion : null,
      siblings: proof.siblings.map((sibling) => sibling.toString()),
      pathIndices: [...proof.pathIndices],
      contractAddress: this.chain.rootRegistryAddress,
      onChain: { root: latestRoot.toString(), version: onChainVersion },
      inSync,
      source: 'nodes',
    };
  }

  /**
   * A conditional read of the current Merkle proof (D74).
   *
   * ⚠️ THE EXISTENCE CHECK COMES FIRST, AND THAT IS NOT NEGOTIABLE. The ETag is
   * `"v<rootVersion>-p<propertyId>"` — deterministic and public, so anyone can
   * write one down without ever having been served the plot. An implementation
   * that compared `If-None-Match` before validating the plot would answer 304
   * for a propertyId that does not exist (instead of 404), for one that is
   * imported but not issued (instead of 400), and — the one that matters — for
   * a REVOKED certificate instead of 410. A verifier polling with a guessed
   * validator would never learn the certificate had been reclaimed.
   *
   * What the 304 still saves is the expensive half: TREE_DEPTH node lookups and
   * TREE_DEPTH Poseidon hashes. What it costs is one primary-key read that the
   * 200 path has to do anyway.
   *
   * ⚠️ AN OUT-OF-SYNC ANSWER GETS NO ETAG. The validator names only the chain's
   * root version, but the body also carries the DATABASE's tree. Between the
   * wallet publishing a root and `confirm()` writing its nodes, the chain is at
   * version N while the node table is still at N−1: that 200 says
   * `inSync: false`, and stamped `"vN-…"` it would be confirmed by 304 on every
   * later revalidation — long after confirm() had caught the table up — until
   * the NEXT publish. `etag` is therefore absent exactly when the response must
   * not be cached.
   */
  async conditionalProof(
    propertyId: string,
    ifNoneMatch: string | undefined,
  ): Promise<{ etag?: string; proof?: MerkleProofResponseDto }> {
    const property = await this.requireIssuedProperty(propertyId);
    const etag = proofETag(await this.chain.getRootVersion(), propertyId);

    if (ifNoneMatch === etag) return { etag };
    const proof = await this.buildProofResponse(property);
    return proof.inSync ? { etag, proof } : { proof };
  }

  /**
   * Verify a proof on behalf of a client (buyer, bank, or the verifier portal).
   *
   * ⚠️ Verification is NOT just `groth16.verify()`. `currentTimestamp` is a
   * public input the PROVER chooses, so a proof dated back to when an expired
   * title was still valid verifies perfectly (D26), and a proof made against a
   * superseded root proves membership in a tree the registry has abandoned.
   * The four checks below are exactly the four LandRegistryVerifier applies
   * on-chain (the fourth, D79, to ownership and mortgage only), and they
   * reject with the same names (D33) so a portal can show one reason
   * regardless of which layer answered.
   */
  async verify(dto: VerifyProofDto): Promise<VerifyProofResponseDto> {
    const circuitType = this.resolveCircuitType(dto);
    const publicSignals = dto.publicSignals as PublicSignals;
    const proof = dto.proof as unknown as Groth16Proof;

    // 1. Freshness (D26) — checked first because it is the cheapest, and
    //    because a replayed proof is cryptographically perfect.
    try {
      assertProofFresh(circuitType, publicSignals);
    } catch (error) {
      throw this.rejection('StaleTimestamp', (error as Error).message);
    }

    // 2. The cryptographic check itself.
    if (!(await this.verifyCryptographically(circuitType, publicSignals, proof))) {
      throw this.rejection(
        'InvalidProof',
        `The Groth16 proof is not valid for the ${circuitType} circuit`,
      );
    }

    // 3. The root must be the one the registry currently stands behind. Without
    //    this a proof stays "valid" forever against the tree it was made in,
    //    including after the property has been transferred away.
    const claimedRoot = BigInt(
      publicSignals[publicSignalIndex(circuitType, rootSignalName(circuitType))],
    );
    const latestRoot = await this.chain.getLatestRoot();
    if (claimedRoot !== latestRoot) {
      throw this.rejection(
        'RootMismatch',
        'The proof was generated against a root that is no longer current — ' +
          'the owner must refresh their Merkle proof (GET /api/proof/:propertyId) and re-prove',
        { expected: latestRoot.toString(), actual: claimedRoot.toString() },
      );
    }

    // 4. Owner must not be frozen (D79). Ownership/mortgage only — approve()
    //    verifies a transfer proof AFTER freezing, so it is exempt (D81).
    let ownerNotFrozen: boolean | null = null;
    if (circuitType !== 'transfer') {
      const propertyId = publicSignals[publicSignalIndex(circuitType, 'propertyId')];
      const commitment = BigInt(publicSignals[publicSignalIndex(circuitType, 'ownerCommitment')]);
      const frozen = (await this.chain.getFrozenOwners([propertyId])).get(propertyId) ?? 0n;
      if (frozen !== 0n && frozen === commitment) {
        throw this.rejection(
          'OwnerFrozen',
          `The owner of property ${propertyId} is frozen by a pending transfer or revocation — ` +
            'this certificate cannot back a proof until the registry publishes or lifts the procedure',
          { propertyId },
        );
      }
      ownerNotFrozen = true;
    }

    // 5. Optionally let the contract answer for itself.
    let onChain: boolean | null = null;
    if (dto.onChain) {
      try {
        onChain = await this.chain.verifyOnChain(circuitType, proof, publicSignals);
      } catch (error) {
        if (error instanceof ProofRejectedError) {
          throw this.rejection(error.reason, error.message, error.details);
        }
        throw error;
      }
    }

    return {
      valid: true,
      circuitType,
      checks: {
        cryptographic: true,
        freshness: true,
        rootMatchesChain: true,
        ownerNotFrozen,
        onChain,
      },
      disclosed: describePublicSignals(circuitType, publicSignals),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async requireIssuedProperty(propertyId: string): Promise<Property> {
    const property = await this.prisma.property.findUnique({ where: { propertyId } });
    if (!property) {
      throw new NotFoundException(`Unknown propertyId ${propertyId}`);
    }
    if (property.status === 'REVOKED') {
      throw new GoneException(
        `The certificate for property ${propertyId} has been revoked. Its leaf is no longer in ` +
          `the tree, so no Merkle proof exists — see the on-chain revocations mapping for the reason.`,
      );
    }
    if (property.ownerCommitment === null) {
      throw new BadRequestException(
        `Property ${propertyId} has been imported but not issued yet, so it has no leaf and ` +
          `is not in the Merkle tree (the owner commitment is created at issue time — D14)`,
      );
    }
    return property;
  }

  /**
   * Off-chain snarkjs verification, with the missing-artifact case separated
   * out. A fresh clone has no `.zkey`/`verification_key.json` (both gitignored,
   * D32), and reporting that as "your proof is invalid" would send a verifier
   * hunting for a problem in their proof that is really a problem on the server.
   */
  private async verifyCryptographically(
    circuitType: CircuitType,
    publicSignals: PublicSignals,
    proof: Groth16Proof,
  ): Promise<boolean> {
    const { vkeyPath } = getCircuitPaths(circuitType, blockchainDir());
    try {
      return await verifyGroth16Proof(vkeyPath, publicSignals, proof);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new ServiceUnavailableException(
          `The verification key for the ${circuitType} circuit is missing (${vkeyPath}). ` +
            `Run: pnpm --filter blockchain run circuits:setup`,
        );
      }
      throw error;
    }
  }

  /**
   * Which circuit this proof belongs to. An explicitly stated type is checked
   * against the signal count rather than believed: the count is a property of
   * the proof, the field is a claim about it.
   */
  private resolveCircuitType(dto: VerifyProofDto): CircuitType {
    let inferred: CircuitType;
    try {
      inferred = circuitTypeForSignalCount(dto.publicSignals.length);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    if (dto.circuitType && dto.circuitType !== inferred) {
      throw new BadRequestException(
        `circuitType says '${dto.circuitType}' but ${dto.publicSignals.length} public signals ` +
          `describe a '${inferred}' proof (D21)`,
      );
    }
    return inferred;
  }

  /** A 422 in the shape the transfer flow already returns, so clients parse one thing. */
  private rejection(
    reason: string,
    message: string,
    details?: Record<string, string>,
  ): UnprocessableEntityException {
    return new UnprocessableEntityException({ valid: false, reason, message, details });
  }
}
