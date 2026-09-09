import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Where the change landed on chain. Null rootVersion means "not yet published". */
export interface EventAnchor {
  rootVersion: number | null;
  txHash: string | null;
}

export interface IssuedEventInput {
  propertyId: string;
  ownerCommitment: string;
  leaf: string;
}

export interface TransferredEventInput {
  propertyId: string;
  previousOwnerCommitment: string | null;
  newOwnerCommitment: string;
  previousLeaf: string | null;
  newLeaf: string;
}

export interface RevokedEventInput {
  propertyId: string;
  previousLeaf: string | null;
  reasonCode: number;
  /**
   * keccak256(detailText) — the same value written to Revocation.detailHash
   * and to the on-chain `revocations` mapping. The free-text reason itself
   * must never reach `property_events`: this row is served verbatim by the
   * unauthenticated `GET /api/records/:propertyId/history`, and the design
   * keeps that text off the blockchain precisely so it does not become a
   * permanent public record — publishing it here would undo that.
   */
  detailHash: string;
}

/**
 * PropertyEventService — the only writer of `property_events` (D48).
 *
 * Every method returns Prisma statements rather than executing them, so the
 * caller can run them inside the same transaction as the change they describe.
 * A history row that commits while the change it records rolls back would be
 * worse than no history at all.
 */
@Injectable()
export class PropertyEventService {
  constructor(private readonly prisma: PrismaService) {}

  issuedStatements(
    inputs: IssuedEventInput[],
    anchor: EventAnchor,
  ): Prisma.PrismaPromise<unknown>[] {
    if (inputs.length === 0) return [];
    return [
      this.prisma.propertyEvent.createMany({
        data: inputs.map((input) => ({
          propertyId: input.propertyId,
          kind: 'ISSUED' as const,
          rootVersion: anchor.rootVersion,
          txHash: anchor.txHash,
          newOwnerCommitment: input.ownerCommitment,
          newLeaf: input.leaf,
        })),
      }),
    ];
  }

  transferredStatements(
    inputs: TransferredEventInput[],
    anchor: EventAnchor,
  ): Prisma.PrismaPromise<unknown>[] {
    if (inputs.length === 0) return [];
    return [
      this.prisma.propertyEvent.createMany({
        data: inputs.map((input) => ({
          propertyId: input.propertyId,
          kind: 'TRANSFERRED' as const,
          rootVersion: anchor.rootVersion,
          txHash: anchor.txHash,
          previousOwnerCommitment: input.previousOwnerCommitment,
          newOwnerCommitment: input.newOwnerCommitment,
          previousLeaf: input.previousLeaf,
          newLeaf: input.newLeaf,
        })),
      }),
    ];
  }

  revokedStatements(
    inputs: RevokedEventInput[],
    anchor: EventAnchor,
  ): Prisma.PrismaPromise<unknown>[] {
    if (inputs.length === 0) return [];
    return [
      this.prisma.propertyEvent.createMany({
        data: inputs.map((input) => ({
          propertyId: input.propertyId,
          kind: 'REVOKED' as const,
          rootVersion: anchor.rootVersion,
          txHash: anchor.txHash,
          previousLeaf: input.previousLeaf,
          detail: { reasonCode: input.reasonCode, detailHash: input.detailHash },
        })),
      }),
    ];
  }

  /**
   * Oldest first — a history reads forwards.
   *
   * `occurredAt` is `@default(now())`, which Prisma compiles to Postgres
   * `CURRENT_TIMESTAMP`. That value is frozen at transaction start and does
   * not advance mid-transaction, so events for the same property written
   * inside one `$transaction` (see the class doc) land with a byte-identical
   * `occurredAt`. `id` is the secondary sort key because it is the one thing
   * that *does* capture insertion order within that transaction — the real
   * ordering signal here, which `occurredAt` alone cannot express.
   */
  async listFor(propertyId: string) {
    return this.prisma.propertyEvent.findMany({
      where: { propertyId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
  }
}
