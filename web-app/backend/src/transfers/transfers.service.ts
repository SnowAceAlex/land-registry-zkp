import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Property, TransferStatus } from '@prisma/client';
import {
  BN254_FIELD_MODULUS,
  Groth16Proof,
  PublicSignals,
  assertProofFresh,
  getCircuitPaths,
  hashRecord,
  verifyGroth16Proof,
} from '@land-registry/blockchain/shared';

import { ChainService, ProofRejectedError } from '../chain/chain.service';
import { blockchainDir } from '../common/paths';
import { FreezeService } from '../freeze/freeze.service';
import { IssuanceService } from '../issuance/issuance.service';
import { PrismaService } from '../prisma/prisma.service';
import { NodeStoreService } from '../tree/node-store.service';
import { toLURRecord } from '../records/record.mapper';
import { SubmitTransferDto, TransferPreviewDto } from './dto/transfer.dto';
import {
  TransferApprovalResponseDto,
  TransferPreviewResult,
  TransferRequestDto,
} from './dto/transfer.response.dto';
import { toTransferRequestDto } from './transfer-request.serializer';

/**
 * TransfersService — the two-part transfer flow of D28.
 *
 * Part 1 (preview) is automatic and public: computing what the tree would look
 * like after the transfer reveals nothing and needs no judgement. Without it
 * the two parties simply cannot run transfer.circom — the new Merkle path is a
 * private input only the registry can compute. Since D77 it also issues the
 * buyer's secret, which submit stores with the request and the change set's
 * archive delivers — the same path an issued owner's secret takes.
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
const OLD_OWNER_COMMITMENT = 3;
const NEW_OWNER_COMMITMENT = 4;

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeStoreService,
    private readonly chain: ChainService,
    private readonly issuance: IssuanceService,
    private readonly freezes: FreezeService,
  ) {}

  /**
   * D28 step 2 — both Merkle paths the transfer.circom witness needs.
   * Read-only: nothing is persisted and no root is published.
   *
   * ⚠️ This is the hottest path in the system — one call per transaction at the
   * counter, ~65,000 a month at HCMC volumes. Before D72 it rebuilt the WHOLE
   * tree twice per call. It is now ~2·TREE_DEPTH key lookups: the old path read
   * from the node table, the new one from an overlay of the single changed leaf.
   */
  async preview(dto: TransferPreviewDto): Promise<TransferPreviewResult> {
    const property = await this.requireTransferableProperty(dto.propertyId);

    // D77 — the buyer's secret is issued here, by the same generator and to the
    // same 248-bit bound as an issuance round's (D14). Nothing is stored: the
    // secret comes back with the proof at submit and is saved in that same
    // insert, so an abandoned preview leaves no row behind.
    const newOwnerSecret = this.issuance.generateOwnerSecret();
    const newOwnerCommitment = (await this.issuance.commitmentFor(newOwnerSecret)).toString();

    const oldProof = await this.nodes.proofFor(property);

    // Only `ownerCommitment` may differ — transfer.circom derives both leaves
    // from one set of record-field signals (D41/§2.4), so the projection swaps
    // that single field and leaves the leaf in its propertyId slot.
    const moved = { ...property, ownerCommitment: newOwnerCommitment };
    const newLeaf = await hashRecord(toLURRecord(moved));
    const overlay = await this.nodes.projectRoot(new Map([[Number(dto.propertyId), newLeaf]]));
    const newProof = await this.nodes.proofInOverlay(property, newLeaf, overlay);

    return {
      propertyId: dto.propertyId,
      newOwnerSecret: newOwnerSecret.toString(),
      newOwnerCommitment,
      rootVersion: await this.chain.getRootVersion(),
      oldMerkleRoot: oldProof.root.toString(),
      newMerkleRoot: overlay.root.toString(),
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
    await this.assertSecretOpensCommitment(dto.newOwnerSecret, dto.newOwnerCommitment);
    await this.verifyOffChain(proof, publicSignals);

    const latestRoot = await this.chain.getLatestRoot();
    if (BigInt(publicSignals[OLD_ROOT]) !== latestRoot) {
      throw new UnprocessableEntityException(
        'The proof was generated against a root that is no longer current. ' +
          'Request a fresh transfer preview and re-generate the proof.',
      );
    }

    // Blocks APPROVED as well as PENDING (D46). Approval used to publish
    // immediately, which serialised transfers per property as a side effect;
    // now an approved transfer waits in a change set, so without this a second
    // transfer could be submitted and approved for the same property while the
    // first is still unbatched. The change set would then hold two different
    // newOwnerCommitment values for one plot and silently apply one of them.
    const open = await this.prisma.transferRequest.findFirst({
      where: {
        propertyId: property.propertyId,
        status: { in: [TransferStatus.PENDING, TransferStatus.APPROVED] },
      },
    });
    if (open) {
      throw new ConflictException(
        `Transfer request #${open.id} for property ${property.propertyId} is already ` +
          `${open.status === TransferStatus.PENDING ? 'pending approval' : 'approved and awaiting publication'}`,
      );
    }

    // D80: one open procedure per plot — a pending revocation freezes the same
    // owner a transfer would, so this must be checked before the freeze below.
    const revocation = await this.prisma.revocation.findFirst({
      where: { propertyId: property.propertyId, status: 'PENDING' },
    });
    if (revocation) {
      throw new ConflictException(
        `Property ${property.propertyId} has a pending revocation (#${revocation.id}) and ` +
          `cannot be transferred while it is open`,
      );
    }

    // D80: freeze first, record second. The seller's commitment comes from the
    // proof, which binds it to the leaf in latestRoot.
    await this.freezes.assertFrozen(property.propertyId, publicSignals[OLD_OWNER_COMMITMENT]);

    const created = await this.prisma.transferRequest.create({
      data: {
        propertyId: dto.propertyId,
        newOwnerCommitment: dto.newOwnerCommitment,
        newOwnerSecret: dto.newOwnerSecret,
        oldRoot: publicSignals[OLD_ROOT],
        newRoot: publicSignals[NEW_ROOT],
        proof: dto.proof as object,
        publicSignals: dto.publicSignals as object,
      },
    });
    return toTransferRequestDto(created);
  }

  async list(status?: TransferStatus): Promise<TransferRequestDto[]> {
    const rows = await this.prisma.transferRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toTransferRequestDto);
  }

  /**
   * D28 step 4 — the human decision.
   *
   * This used to also publish the new root right here (verify on-chain,
   * re-derive the projected root from current DB state, publish, then write
   * Property.ownerCommitment). That coupling is gone: the backend can no
   * longer sign a publishRoot() transaction, because on-chain writes are now
   * signed in the officer's browser wallet (D43). Approval therefore stops at
   * recording the decision — PENDING → APPROVED — and nothing else changes
   * yet. The actual publish moves to a later batched change-set flow that
   * groups every approved transfer (and revocation) into one root for an
   * officer to sign; until that flow exists, an approved transfer sits at
   * APPROVED with Property.ownerCommitment still unchanged.
   *
   * The proof is still verified here rather than only at publish time: a
   * proof that does not verify must never sit in the approved queue.
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

    // D80: re-checked rather than assumed — an unfreeze signed from another
    // session must not let an APPROVED transfer wait unfrozen for the change set.
    await this.freezes.assertFrozen(request.propertyId, publicSignals[OLD_OWNER_COMMITMENT]);

    const updated = await this.prisma.transferRequest.update({
      where: { id },
      data: { status: TransferStatus.APPROVED, decidedAt: new Date() },
    });

    this.logger.log(
      `transfer #${id} approved for property ${request.propertyId} — queued for the next change set`,
    );

    return {
      id: updated.id,
      propertyId: updated.propertyId,
      status: updated.status,
      decidedAt: updated.decidedAt,
    };
  }

  async reject(id: number, reason?: string): Promise<TransferRequestDto> {
    const request = await this.requirePendingRequest(id);
    const updated = await this.prisma.transferRequest.update({
      where: { id: request.id },
      data: {
        status: TransferStatus.REJECTED,
        rejectReason: reason ?? 'Rejected by the issuing authority',
        // D77 — a rejected commitment never reaches the chain, so its secret
        // has no further use.
        newOwnerSecret: null,
        decidedAt: new Date(),
      },
    });
    return toTransferRequestDto(updated);
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

  /**
   * D77 — the secret stored with a request must open its commitment, or the
   * change set's archive would hand the buyer a key to nothing. Bounded below
   * the BN254 field because Poseidon reduces its input: a value ≥ p opens the
   * same commitment as its residue, while the owner's proofs would later be
   * built from a different number.
   */
  private async assertSecretOpensCommitment(secret: string, commitment: string): Promise<void> {
    const value = BigInt(secret);
    if (value <= 0n || value >= BN254_FIELD_MODULUS) {
      throw new BadRequestException('newOwnerSecret must be a field element in (0, p)');
    }
    if ((await this.issuance.commitmentFor(value)).toString() !== commitment) {
      throw new BadRequestException('newOwnerSecret does not open newOwnerCommitment');
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
      throw new BadRequestException('publicSignals newOwnerCommitment does not match the request');
    }
  }

  private async requireTransferableProperty(propertyId: string): Promise<Property> {
    const property = await this.prisma.property.findUnique({ where: { propertyId } });
    if (!property) {
      throw new NotFoundException(`Unknown propertyId ${propertyId}`);
    }
    // Mirrors ProofService.requireIssuedProperty: a revoked plot keeps its
    // ownerCommitment (only leaf/merkleProof/rootVersion are cleared, D45), so
    // the ownerCommitment check below alone would let it through and fail
    // deep inside generateMerkleProof — "propertyId not found in tree" — as
    // an unhandled 500 instead of a readable error.
    if (property.status === 'REVOKED') {
      throw new GoneException(
        `The certificate for property ${propertyId} has been revoked. Its leaf is no longer in ` +
          `the tree, so no Merkle proof exists — see the on-chain revocations mapping for the reason.`,
      );
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
