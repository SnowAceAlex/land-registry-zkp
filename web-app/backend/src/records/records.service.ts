import { Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationParams, pageArgs, serializeProperty } from '../common/pagination';

/**
 * RecordsService
 * ─────────────────────────────────────────────────────────────────────────────
 * Read access to the LUR registry.
 *
 * Writes deliberately do NOT live here. Any change to a record changes its leaf
 * and therefore the Merkle root, so it must be followed by a rebuild and a
 * publish — otherwise the on-chain root silently stops describing the database
 * and every issued proof breaks. Creation goes through the government import +
 * issuance flow, which does both in one place.
 */
@Injectable()
export class RecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: PaginationParams = {}) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({ ...pageArgs(params), orderBy: { id: 'asc' } }),
      this.prisma.property.count(),
    ]);

    return { total, items: items.map(serializeProperty) };
  }

  async findById(propertyId: string) {
    const property = await this.prisma.property.findUnique({ where: { propertyId } });
    if (!property) {
      throw new NotFoundException(`Unknown propertyId ${propertyId}`);
    }
    return serializeProperty(property);
  }

  async create(_dto: Record<string, unknown>): Promise<never> {
    throw new NotImplementedException(
      'Create records through POST /api/government/import — a standalone create would ' +
        'leave the published Merkle root out of sync with the database.',
    );
  }

  async update(_propertyId: string, _dto: Record<string, unknown>): Promise<never> {
    throw new NotImplementedException(
      'Editing a record changes its leaf hash. Use the government endpoints, which ' +
        'rebuild the tree and publish a new root in the same operation.',
    );
  }

  async remove(_propertyId: string): Promise<never> {
    throw new NotImplementedException(
      'Records are never deleted — the registry only ever deactivates state (D29).',
    );
  }
}
