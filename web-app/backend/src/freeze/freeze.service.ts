import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ChainService } from '../chain/chain.service';
import { PrismaService } from '../prisma/prisma.service';
import { FreezeCalldataDto, FreezeStatusDto, OpenProcedureDto } from './dto/freeze-status.dto';

/** How many plots one freezeOwners transaction carries (D79). */
export const MAX_FREEZES_PER_TX = 200;

/** The 409 every "freeze first, record second" gate throws (D80). */
export function ownerNotFrozen(propertyIds: string[]): ConflictException {
  return new ConflictException({
    reason: 'OwnerNotFrozen',
    message:
      `The current owner of property ${propertyIds.join(', ')} is not frozen on chain. ` +
      'Sign freezeOwners for it first — a procedure is recorded only after its freeze (D80).',
    details: { propertyIds: propertyIds.join(',') },
  });
}

/**
 * FreezeService — reads the on-chain freeze register (D79/D80). The backend
 * sends no transactions (D43); it only refuses to record until the chain shows the freeze.
 */
@Injectable()
export class FreezeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  /** Everything the portal needs to freeze, or unfreeze, one plot. */
  async status(propertyId: string): Promise<FreezeStatusDto> {
    const property = await this.prisma.property.findUnique({ where: { propertyId } });
    if (!property) throw new NotFoundException(`Unknown propertyId ${propertyId}`);
    if (property.status !== 'ISSUED' || property.ownerCommitment === null) {
      throw new ConflictException(
        `Property ${propertyId} is ${property.status}; only an ISSUED plot has an owner to freeze`,
      );
    }

    const [frozen, openProcedure] = await Promise.all([
      this.chain.getFrozenOwners([propertyId]),
      this.openProcedure(propertyId),
    ]);
    // D79: the contract's default (unset) mapping value is 0 — never a real commitment.
    const frozenValue = frozen.get(propertyId);
    const frozenOnChain = frozenValue !== 0n && frozenValue === BigInt(property.ownerCommitment);

    return {
      propertyId,
      ownerCommitment: property.ownerCommitment,
      frozenOnChain,
      openProcedure,
      freezeCalldata: { propertyIds: [propertyId], ownerCommitments: [property.ownerCommitment] },
      // Unfreezing an OPEN procedure reopens exactly the window D79 closes.
      unfreezeAllowed: frozenOnChain && openProcedure === null,
    };
  }

  /** The gate itself: the chain must freeze exactly this commitment. */
  async assertFrozen(propertyId: string, ownerCommitment: string): Promise<void> {
    const frozen = await this.chain.getFrozenOwners([propertyId]);
    const frozenValue = frozen.get(propertyId);
    // D79: 0 is the contract's "not frozen" default, never a real commitment.
    if (frozenValue === 0n || frozenValue !== BigInt(ownerCommitment)) throw ownerNotFrozen([propertyId]);
  }

  /**
   * The plots among these whose CURRENT owner the chain does not freeze — the
   * change-set queue check (D80). Input order, duplicates dropped.
   */
  async unfrozenAmong(propertyIds: string[]): Promise<FreezeCalldataDto> {
    const unique = [...new Set(propertyIds)];
    if (unique.length === 0) return { propertyIds: [], ownerCommitments: [] };

    const [rows, frozen] = await Promise.all([
      this.prisma.property.findMany({
        where: { propertyId: { in: unique } },
        select: { propertyId: true, ownerCommitment: true },
      }),
      this.chain.getFrozenOwners(unique),
    ]);
    const commitmentOf = new Map(rows.map((row) => [row.propertyId, row.ownerCommitment]));

    const gaps = unique.filter((id) => {
      const commitment = commitmentOf.get(id);
      return commitment !== null && commitment !== undefined && frozen.get(id) !== BigInt(commitment);
    });
    return { propertyIds: gaps, ownerCommitments: gaps.map((id) => commitmentOf.get(id)!) };
  }

  private async openProcedure(propertyId: string): Promise<OpenProcedureDto | null> {
    const [transfer, revocation] = await Promise.all([
      this.prisma.transferRequest.findFirst({
        where: { propertyId, status: { in: ['PENDING', 'APPROVED'] } },
        select: { id: true, status: true },
      }),
      this.prisma.revocation.findFirst({
        where: { propertyId, status: 'PENDING' },
        select: { id: true },
      }),
    ]);
    if (transfer) {
      return { kind: 'transfer', id: transfer.id, status: transfer.status as 'PENDING' | 'APPROVED' };
    }
    if (revocation) return { kind: 'revocation', id: revocation.id };
    return null;
  }
}
