import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Property, TransferStatus } from '@prisma/client';
import {
  Groth16Proof,
  PublicSignals,
  assertProofFresh,
  getCircuitPaths,
  verifyGroth16Proof,
} from '@land-registry/blockchain/shared';

import { ChainService, ProofRejectedError, RootPublishError } from '../chain/chain.service';
import { blockchainDir } from '../common/paths';
import { PrismaService } from '../prisma/prisma.service';
import { RootService } from './root.service';
import { TreeService } from '../tree/tree.service';
import { SubmitTransferDto, TransferPreviewDto, TransferPreviewResult } from './dto/transfer.dto';
import {
  TransferApprovalResponseDto,
  TransferRequestDto,
} from './dto/transfer.response.dto';

/**
 * TransfersService — the two-part transfer flow of D28.
 *
 * Part 1 (preview) is automatic and public: computing what the tree would look
 * like after the transfer reveals nothing and needs no judgement. Without it
 * the two parties simply cannot run transfer.circom — the new Merkle path is a
 * private input only the registry can compute.
 *
 * Part 2 (approve) requires a human at the authority. A transfer proof shows
 * that someone holds the old owner's secret; it cannot show that they are the
 * old owner (ownerCommitment is pseudonymous, D8). Notarisation is exactly the
 * part ZK cannot reach.
 */

/** publicSignals indices, PUBLIC_SIGNAL_ORDER.transfer (D21). */
const OLD_ROOT = 0;
const NEW_ROOT = 1;
const PROPERTY_ID = 2;
const NEW_OWNER_COMMITMENT = 4;

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: TreeService,
    private readonly chain: ChainService,
    private readonly roots: RootService,
  ) {}

  /**
   * D28 step 2 — compute the projected tree and hand back both Merkle paths.
   * Read-only: nothing is persisted and no root is published.
   */
  async preview(dto: TransferPreviewDto): Promise<TransferPreviewResult> {
    const property = await this.requireTransferableProperty(dto.propertyId);

    const { tree: currentTree } = await this.tree.buildCurrentTree();
    const oldProof = await this.tree.proofFor(currentTree, property);

    const { tree: projectedTree } = await this.tree.buildProjectedTree(
      new Map([[dto.propertyId, dto.newOwnerCommitment]]),
    );
    const newProof = await this.tree.proofFor(projectedTree, {
      ...property,
      ownerCommitment: dto.newOwnerCommitment,
    });

    return {
      propertyId: dto.propertyId,
      rootVersion: await this.chain.getRootVersion(),
      oldMerkleRoot: currentTree.root.toString(),
      newMerkleRoot: projectedTree.root.toString(),
      oldSiblings: oldProof.siblings.map((s) => s.toString()),
      oldPathIndices: oldProof.pathIndices,
      newSiblings: newProof.siblings.map((s) => s.toString()),
      newPathIndices: newProof.pathIndices,
    };
  }

  /**
   * D28 step 3 — accept a proof into the pending queue.
   * Validated eagerly so a broken submission is rejected while the submitter is
   * still watching, rather than surfacing later at an officer's desk.
   */
  async submit(dto: SubmitTransferDto): Promise<TransferRequestDto> {
    const property = await this.requireTransferableProperty(dto.propertyId);
    const proof = dto.proof as unknown as Groth16Proof;
    const publicSignals = dto.publicSignals as PublicSignals;

    this.assertSignalsMatch(publicSignals, dto);
    await this.verifyOffChain(proof, publicSignals);

    const latestRoot = await this.chain.getLatestRoot();
    if (BigInt(publicSignals[OLD_ROOT]) !== latestRoot) {
      throw new UnprocessableEntityException(
        'The proof was generated against a root that is no longer current. ' +
          'Request a fresh transfer preview and re-generate the proof.',
      );
    }

    const pending = await this.prisma.transferRequest.findFirst({
      where: { propertyId: property.propertyId, status: TransferStatus.PENDING },
    });
    if (pending) {
      throw new ConflictException(
        `Transfer request #${pending.id} for property ${property.propertyId} is already pending approval`,
      );
    }

    return this.prisma.transferRequest.create({
      data: {
        propertyId: dto.propertyId,
        newOwnerCommitment: dto.newOwnerCommitment,
        oldRoot: publicSignals[OLD_ROOT],
        newRoot: publicSignals[NEW_ROOT],
        proof: dto.proof as object,
        publicSignals: dto.publicSignals as object,
      },
    });
  }

  async list(status?: TransferStatus): Promise<TransferRequestDto[]> {
    return this.prisma.transferRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * D28 step 4 — the human decision, followed by the state change.
   *
   * Order matters: verify on-chain, re-derive the projected root from current
   * DB state, publish, and only then write. The re-derivation is what stops an
   * officer from approving a proof whose newRoot no longer corresponds to the
   * registry (for example after another transfer landed first).
   */
  async approve(id: number): Promise<TransferApprovalResponseDto> {
    const request = await this.requirePendingRequest(id);
    const proof = request.proof as unknown as Groth16Proof;
    const publicSignals = request.publicSignals as PublicSignals;

    // Freshness is re-checked here, not just at submit: the proof may have sat
    // in the queue for hours, and a stale timestamp is exactly what D26 warns
    // about — the contract would reject it anyway, with less context.
    try {
      assertProofFresh('transfer', publicSignals);
    } catch (error) {
      throw new UnprocessableEntityException(
        `${(error as Error).message} — ask the parties to re-generate the transfer proof.`,
      );
    }

    try {
      await this.chain.verifyTransferOnChain(proof, publicSignals);
    } catch (error) {
      if (error instanceof ProofRejectedError) {
        // RootMismatch means the registry moved on while this waited; the
        // request can never become valid again, so close it rather than leave
        // it pending forever.
        if (error.reason === 'RootMismatch') {
          await this.reject(id, error.message);
        }
        throw new UnprocessableEntityException({
          reason: error.reason,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }

    const { tree, properties } = await this.tree.buildProjectedTree(
      new Map([[request.propertyId, request.newOwnerCommitment]]),
    );

    if (tree.root !== BigInt(request.newRoot)) {
      throw new UnprocessableEntityException(
        `The registry no longer produces the new root this proof commits to ` +
          `(expected ${request.newRoot}, current projection ${tree.root}). ` +
          `The transfer must be re-proven against fresh state.`,
      );
    }

    let published: { root: bigint; version: number; txHash: string };
    try {
      published = await this.chain.publishRoot(tree.root);
    } catch (error) {
      if (error instanceof RootPublishError) {
        throw new UnprocessableEntityException({
          reason: error.reason,
          message:
            error.reason === 'DuplicateRoot'
              ? 'This transfer leaves the registry unchanged (the new owner commitment ' +
                'equals the current one), so there is no new root to publish'
              : error.message,
        });
      }
      throw error;
    }

    try {
      await this.prisma.$transaction([
        this.prisma.property.update({
          where: { propertyId: request.propertyId },
          data: { ownerCommitment: request.newOwnerCommitment },
        }),
        this.roots.recordRootStatement(published),
        ...(await this.roots.proofCacheStatements(tree, properties, published.version)),
        this.prisma.transferRequest.update({
          where: { id },
          data: {
            status: TransferStatus.APPROVED,
            txHash: published.txHash,
            decidedAt: new Date(),
          },
        }),
      ]);
    } catch (error) {
      this.roots.warnChainAheadOfDatabase(published.txHash, error);
      throw error;
    }

    this.logger.log(
      `transfer #${id} approved for property ${request.propertyId}; ` +
        `root version ${published.version} (tx ${published.txHash})`,
    );

    return {
      id,
      propertyId: request.propertyId,
      root: published.root.toString(),
      version: published.version,
      txHash: published.txHash,
    };
  }

  async reject(id: number, reason?: string): Promise<TransferRequestDto> {
    const request = await this.requirePendingRequest(id);
    return this.prisma.transferRequest.update({
      where: { id: request.id },
      data: {
        status: TransferStatus.REJECTED,
        rejectReason: reason ?? 'Rejected by the issuing authority',
        decidedAt: new Date(),
      },
    });
  }

  /**
   * Off-chain snarkjs verification. Needs the trusted-setup artifacts to exist
   * locally (`pnpm --filter blockchain run circuits:setup`).
   */
  private async verifyOffChain(proof: Groth16Proof, publicSignals: PublicSignals): Promise<void> {
    try {
      assertProofFresh('transfer', publicSignals);
    } catch (error) {
      throw new UnprocessableEntityException((error as Error).message);
    }

    const { vkeyPath } = getCircuitPaths('transfer', blockchainDir());

    const valid = await verifyGroth16Proof(vkeyPath, publicSignals, proof);
    if (!valid) {
      throw new UnprocessableEntityException('The transfer proof is not cryptographically valid');
    }
  }

  /** The public signals must describe the transfer the request claims to be. */
  private assertSignalsMatch(publicSignals: PublicSignals, dto: SubmitTransferDto): void {
    if (!Array.isArray(publicSignals) || publicSignals.length !== 7) {
      throw new BadRequestException(
        `A transfer proof carries 7 public signals (D21), got ${publicSignals?.length ?? 0}`,
      );
    }
    if (publicSignals[PROPERTY_ID] !== dto.propertyId) {
      throw new BadRequestException(
        `publicSignals propertyId (${publicSignals[PROPERTY_ID]}) does not match the ` +
          `request (${dto.propertyId})`,
      );
    }
    if (publicSignals[NEW_OWNER_COMMITMENT] !== dto.newOwnerCommitment) {
      throw new BadRequestException(
        'publicSignals newOwnerCommitment does not match the request',
      );
    }
  }

  private async requireTransferableProperty(propertyId: string): Promise<Property> {
    const property = await this.prisma.property.findUnique({ where: { propertyId } });
    if (!property) {
      throw new NotFoundException(`Unknown propertyId ${propertyId}`);
    }
    if (property.ownerCommitment === null) {
      throw new BadRequestException(
        `Property ${propertyId} has not been issued yet and is not in the Merkle tree`,
      );
    }
    // Mirrors constraint 7 of transfer.circom (encumbranceStatus === FREE) so
    // the parties get a readable reason instead of an unsatisfiable witness.
    if (property.encumbranceStatus !== 'FREE') {
      throw new BadRequestException(
        `Property ${propertyId} is ${property.encumbranceStatus} and cannot be transferred`,
      );
    }

    // Điều 39 khoản 2: a residential community holding land allocated without a
    // land-use fee has no right to transfer, gift, lease, mortgage or contribute
    // it as capital. This is INDEPENDENT of encumbranceStatus — the circuit
    // knows nothing about who holds the land, so a community parcel marked FREE
    // would otherwise sail through and produce an unlawful transfer.
    if (property.landUserType === 'CDS') {
      throw new BadRequestException(
        `Property ${propertyId} is held by a residential community (landUserType=CDS), which ` +
          `has no right to transfer or mortgage land use rights (Điều 39 khoản 2 Luật Đất đai 2024)`,
      );
    }

    return property;
  }

  private async requirePendingRequest(id: number) {
    const request = await this.prisma.transferRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Unknown transfer request #${id}`);
    }
    if (request.status !== TransferStatus.PENDING) {
      throw new ConflictException(
        `Transfer request #${id} was already ${request.status.toLowerCase()}`,
      );
    }
    return request;
  }
}
