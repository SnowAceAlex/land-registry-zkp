import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * PrismaService
 * ─────────────────────────────────────────────────────────────────────────────
 * A NestJS injectable wrapper around PrismaClient.
 *
 * Prisma 7 requires a driver adapter instead of the built-in Rust query engine.
 * We use @prisma/adapter-pg (backed by the `pg` Pool) for PostgreSQL.
 *
 * The connection URL is read from DATABASE_URL env var at construction time.
 * The datasource URL itself is no longer in schema.prisma — it lives in
 * prisma.config.ts at the package root, which the Prisma CLI reads for
 * migrations and generate.
 *
 * This service is exported by PrismaModule (@Global), so it can be injected
 * into any feature service (RecordsService, ChainService, ProofService, etc.)
 * without importing PrismaModule in each feature module.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
