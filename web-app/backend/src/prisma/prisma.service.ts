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
/**
 * How long a transaction may run before Prisma aborts it.
 *
 * Prisma's default is 5 seconds, and the array form of `$transaction` takes no
 * per-call override — only `isolationLevel` — so this has to be set on the
 * client.
 *
 * 5s is far too short for the one transaction in this system that is genuinely
 * large: confirming a change set writes one row per plot in the round, plus its
 * transfer row, plus its history event, plus the Merkle nodes. A day of HCMC
 * volume (~3,000 transfers) is roughly 9,000 statements, which took just over
 * 5s and was cut off mid-way — found by the bench harness, not in production.
 *
 * Two things bound how long that can get, so this is not an open-ended licence:
 * a change set carries at most `MAX_REVOCATIONS_PER_CHANGESET` revocations
 * (D73), and the officer decides how often to publish.
 */
const PUBLISH_TRANSACTION_TIMEOUT_MS = 120_000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter, transactionOptions: { timeout: PUBLISH_TRANSACTION_TIMEOUT_MS } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
