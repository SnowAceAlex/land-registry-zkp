import { Injectable } from '@nestjs/common';

/**
 * RecordsService
 * ─────────────────────────────────────────────────────────────────────────────
 * Business logic for Land Use Rights (LUR) records management.
 * Talks to the PostgreSQL database via Prisma ORM.
 *
 * TODO:
 *  1. Inject PrismaService (create src/prisma/prisma.service.ts first)
 *     constructor(private readonly prisma: PrismaService) {}
 *
 *  2. Implement findAll() — paginated list of all Property records
 *     return this.prisma.property.findMany({ skip, take, orderBy: { createdAt: 'desc' } });
 *
 *  3. Implement findById(propertyId: string) — get a single Property by propertyId
 *     return this.prisma.property.findUnique({ where: { propertyId } });
 *
 *  4. Implement create(dto: CreatePropertyDto) — create a new Property
 *     Validate that propertyId is unique before inserting.
 *     After creating, trigger ChainService to rebuild the Merkle tree and publish new root.
 *
 *  5. Implement update(propertyId: string, dto: UpdatePropertyDto) — update a record
 *     After updating, trigger Merkle tree rebuild + publishRoot on-chain.
 *
 *  6. Implement delete(propertyId: string) — soft-delete or hard-delete
 *     After deleting, rebuild and publish new Merkle root.
 *
 * NOTE: ownerCommitment is stored as a hex string.
 *       Convert to BigInt when passing to @land-registry/blockchain merkleTree functions.
 */
@Injectable()
export class RecordsService {
  // TODO: inject PrismaService
  // constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    // TODO: implement
    return [];
  }

  async findById(_propertyId: string) {
    // TODO: implement
    return null;
  }

  async create(_dto: Record<string, unknown>) {
    // TODO: implement
    throw new Error('Not implemented');
  }

  async update(_propertyId: string, _dto: Record<string, unknown>) {
    // TODO: implement
    throw new Error('Not implemented');
  }

  async remove(_propertyId: string) {
    // TODO: implement
    throw new Error('Not implemented');
  }
}
