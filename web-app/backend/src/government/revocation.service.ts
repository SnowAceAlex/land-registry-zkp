import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { keccak256, toUtf8Bytes } from 'ethers';

import { PrismaService } from '../prisma/prisma.service';
import { CreateRevocationDto } from './dto/revocation.dto';

/** Must stay in lockstep with MIN/MAX_REASON_CODE in RootRegistry.sol. */
export const REASON_CODES: Record<number, string> = {
  1: 'Thu hồi theo quyết định Nhà nước',
  2: 'Phát hành sai sót',
  3: 'Tranh chấp / quyết định toà án',
  4: 'Hết hạn, không gia hạn',
  5: 'Khác',
};

/**
 * RevocationService — revocation requests, queued until a ChangeSet publishes.
 *
 * Only the keccak256 of the detail text reaches the chain (D45). Free text about
 * why a specific plot lost its certificate — an inheritance dispute, a court
 * order — would otherwise be public and permanent, which is a materially
 * different proposition from a revoked diploma. The hash still lets the registry
 * prove the reason on demand.
 */
@Injectable()
export class RevocationService {
  constructor(private readonly prisma: PrismaService) {}

  async request(dto: CreateRevocationDto) {
    if (!REASON_CODES[dto.reasonCode]) {
      throw new BadRequestException(
        `reasonCode must be one of ${Object.keys(REASON_CODES).join(', ')}`,
      );
    }

    const property = await this.prisma.property.findUnique({
      where: { propertyId: dto.propertyId },
    });
    if (!property) throw new NotFoundException(`Unknown propertyId ${dto.propertyId}`);
    if (property.status !== 'ISSUED') {
      throw new ConflictException(
        `Property ${dto.propertyId} is ${property.status}; only an ISSUED certificate can be revoked`,
      );
    }

    const pending = await this.prisma.revocation.findFirst({
      where: { propertyId: dto.propertyId, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException(
        `Property ${dto.propertyId} already has a pending revocation (#${pending.id})`,
      );
    }

    const created = await this.prisma.revocation.create({
      data: {
        propertyId: dto.propertyId,
        reasonCode: dto.reasonCode,
        detailText: dto.detailText,
        detailHash: keccak256(toUtf8Bytes(dto.detailText)),
        status: 'PENDING',
      },
    });

    return { id: created.id, propertyId: created.propertyId, detailHash: created.detailHash };
  }

  async pending() {
    return this.prisma.revocation.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
  }
}
