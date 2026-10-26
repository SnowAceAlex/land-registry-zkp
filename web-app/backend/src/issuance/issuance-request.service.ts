import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IssuanceRequestStatus } from '@prisma/client';

import { Actor } from '../common/actor';
import { officeCodes } from '../common/office-codes';
import { LineageService } from '../lineage/lineage.service';
import { PrismaService } from '../prisma/prisma.service';
import { IssuanceRequestDto } from './dto/issuance-request.dto';
import { toIssuanceRequestDto } from './issuance-request.serializer';
import { IssuanceService } from './issuance.service';

/**
 * Issuance is a queued procedure (D87): the secret is generated now and kept on the request,
 * Property stays IMPORTED until a change set confirms.
 */
@Injectable()
export class IssuanceRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuance: IssuanceService,
    private readonly lineage: LineageService,
  ) {}

  async request(propertyIds: string[], actor: Actor): Promise<IssuanceRequestDto[]> {
    const ids = [...new Set(propertyIds)];

    const properties = await this.prisma.property.findMany({ where: { propertyId: { in: ids } } });
    const byId = new Map(properties.map((p) => [p.propertyId, p]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new NotFoundException(`Unknown propertyId: ${unknown.join(', ')}`);
    }

    const notImported = properties.filter((p) => p.status !== 'IMPORTED');
    if (notImported.length > 0) {
      throw new ConflictException(
        `Only IMPORTED plots can be queued for issuance: ${notImported
          .map((p) => `${p.propertyId} is ${p.status}`)
          .join(', ')}`,
      );
    }

    const open = await this.prisma.issuanceRequest.findMany({
      where: { propertyId: { in: ids }, status: 'READY' },
      select: { propertyId: true },
    });
    if (open.length > 0) {
      throw new ConflictException(
        `Already queued for issuance: ${open.map((r) => r.propertyId).join(', ')}`,
      );
    }

    await this.lineage.assertPredecessorsRevoked(ids);

    const creates = [];
    for (const id of ids) {
      const secret = this.issuance.generateOwnerSecret();
      const commitment = await this.issuance.commitmentFor(secret);
      creates.push(
        this.prisma.issuanceRequest.create({
          data: {
            propertyId: id,
            ownerSecret: secret.toString(),
            ownerCommitment: commitment.toString(),
            officeId: actor.officeId,
            landOfficeId: byId.get(id)!.landOfficeId,
          },
        }),
      );
    }
    const created = await this.prisma.$transaction(creates);

    const offices = await officeCodes(this.prisma);
    return created.map((row) => toIssuanceRequestDto(row, offices));
  }

  // The actor is unused today (the routes are central-only) but fixes the signature for scoping.
  async list(
    status: IssuanceRequestStatus | undefined,
    _actor: Actor,
  ): Promise<IssuanceRequestDto[]> {
    const [rows, offices] = await Promise.all([
      this.prisma.issuanceRequest.findMany({
        where: status ? { status } : {},
        orderBy: { id: 'asc' },
      }),
      officeCodes(this.prisma),
    ]);
    return rows.map((row) => toIssuanceRequestDto(row, offices));
  }
}
