import {
  BadRequestException,
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
  MerkleProofData,
  PublicSignals,
  assertProofFresh,
  circuitTypeForSignalCount,
  describePublicSignals,
  getCircuitPaths,
  publicSignalIndex,
  rootSignalName,
  verifyGroth16Proof,
  verifyMerkleProof,
} from '@land-registry/blockchain/shared';

import { ChainService, ProofRejectedError } from '../chain/chain.service';
import { blockchainDir } from '../common/paths';
import { PrismaService } from '../prisma/prisma.service';
import { TreeService } from '../tree/tree.service';
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
    private readonly tree: TreeService,
    private readonly chain: ChainService,
  ) {}

  /**
   * The current Merkle proof for one property (D40 — cache-first, self-healing).
   *
   * The cached proof is trusted only while its `rootVersion` matches the chain.
   * That check matters because the cache genuinely can lag: issuance publishes
   * the root BEFORE writing to the database on purpose (a DB write that lands
   * without a publish would leave an owner holding a commitment whose secret
   * exists nowhere), so a window exists where the chain has moved and the rows
   * have not. Serving a stale cached proof would hand the owner something that
   * silently fails to verify.
   */
  async getMerkleProof(propertyId: string): Promise<MerkleProofResponseDto> {
    const property = await this.requireIssuedProperty(propertyId);

    const [latestRoot, onChainVersion] = await Promise.all([
      this.chain.getLatestRoot(),
      this.chain.getRootVersion(),
    ]);

    // The cache is only accepted when its rootVersion is the chain's, so the
    // tree it belongs to is by definition the published one — hence latestRoot
    // as its root. That makes verifying it a real check of cache-against-chain
    // rather than a check of the cache against itself.
    let cached = this.readCachedProof(property, onChainVersion, latestRoot);

    // A row can carry the right version and still be wrong about its contents
    // (a partial write, a hand-edited row). Rebuilding is the self-healing half
    // of D40: the tree can answer this correctly in milliseconds, so blocking
    // the owner until an officer republishes would be a self-inflicted outage.
    if (cached && !(await verifyMerkleProof(cached, latestRoot))) {
      this.logger.warn(
        `cached Merkle proof for property ${propertyId} claims root version ${onChainVersion} ` +
          `but does not verify against it — rebuilding. Run POST /api/government/publish-root ` +
          `to repair the cache.`,
      );
      cached = undefined;
    }

    const source = cached ? ('cache' as const) : ('rebuilt' as const);
    const proof = cached ?? (await this.rebuild(property));
    const root = proof.root;

    // Reaching here means a freshly built proof does not verify against the
    // tree it was just built from, so the fault is deeper than the cache.
    // Never hand out a proof this service can already tell is broken — the
    // owner would find out only when proving failed, with no explanation.
    if (!cached && !(await verifyMerkleProof(proof, root))) {
      throw new ServiceUnavailableException(
        `The Merkle proof rebuilt for property ${propertyId} does not verify against the ` +
          `registry tree. Run POST /api/government/publish-root and check the server logs.`,
      );
    }

    const inSync = root === latestRoot;
    if (!inSync) {
      this.logger.warn(
        `proof for property ${propertyId} was built against root ${root}, but the chain holds ` +
          `${latestRoot} (version ${onChainVersion}) — the database has unpublished changes`,
      );
    }

    return {
      propertyId: property.propertyId,
      leaf: proof.leaf.toString(),
      merkleRoot: root.toString(),
      // A root that is not the chain's has no version yet, and inventing one
      // would put a number in a refreshed receipt that means nothing on-chain.
      rootVersion: inSync ? onChainVersion : null,
      siblings: proof.siblings.map((sibling) => sibling.toString()),
      pathIndices: [...proof.pathIndices],
      contractAddress: this.chain.rootRegistryAddress,
      onChain: { root: latestRoot.toString(), version: onChainVersion },
      inSync,
      source,
    };
  }

  /**
   * Verify a proof on behalf of a client (buyer, bank, or the verifier portal).
   *
   * ⚠️ Verification is NOT just `groth16.verify()`. `currentTimestamp` is a
   * public input the PROVER chooses, so a proof dated back to when an expired
   * title was still valid verifies perfectly (D26), and a proof made against a
   * superseded root proves membership in a tree the registry has abandoned.
   * The three checks below are exactly the three LandRegistryVerifier applies
   * on-chain, and they reject with the same names (D33) so a portal can show
   * one reason regardless of which layer answered.
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

    // 4. Optionally let the contract answer for itself.
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
      checks: { cryptographic: true, freshness: true, rootMatchesChain: true, onChain },
      disclosed: describePublicSignals(circuitType, publicSignals),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async requireIssuedProperty(propertyId: string): Promise<Property> {
    const property = await this.prisma.property.findUnique({ where: { propertyId } });
    if (!property) {
      throw new NotFoundException(`Unknown propertyId ${propertyId}`);
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
   * The cached proof, if it is usable. Returns undefined — rather than throwing
   * — whenever anything is missing or belongs to an older root, because that is
   * a normal state that the rebuild path handles.
   */
  private readCachedProof(
    property: Property,
    onChainVersion: number,
    latestRoot: bigint,
  ): MerkleProofData | undefined {
    if (
      property.leaf === null ||
      property.merkleProof === null ||
      property.rootVersion === null ||
      property.rootVersion !== onChainVersion
    ) {
      return undefined;
    }

    const cached = property.merkleProof as { siblings?: unknown; pathIndices?: unknown };
    if (!Array.isArray(cached.siblings) || !Array.isArray(cached.pathIndices)) {
      return undefined;
    }

    return {
      leaf: BigInt(property.leaf),
      siblings: (cached.siblings as string[]).map((sibling) => BigInt(sibling)),
      pathIndices: cached.pathIndices as number[],
      root: latestRoot,
    };
  }

  /** Rebuild the whole tree from current rows and take this property's proof. */
  private async rebuild(property: Property): Promise<MerkleProofData> {
    const { tree } = await this.tree.buildCurrentTree();
    return this.tree.proofFor(tree, property);
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
