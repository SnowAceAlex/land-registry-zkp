import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RecordsService
 * ─────────────────────────────────────────────────────────────────────────────
 * Business logic for Land Use Rights (LUR) records management.
 * Talks to the PostgreSQL database via Prisma ORM.
 *
 * PrismaService is injected via NestJS DI — it is provided globally by
 * PrismaModule which is imported in AppModule.
 *
 * Method stubs are ready to implement:
 *  - findAll()  — paginated list of all Property records
 *  - findById() — single Property by propertyId
 *  - create()   — create a new Property; then trigger Merkle tree rebuild
 *  - update()   — update a record; then trigger Merkle tree rebuild
 *  - remove()   — delete a record; then rebuild and publish Merkle root
 */
@Injectable()
export class RecordsService {
  constructor(private readonly prisma: PrismaService) {}

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
