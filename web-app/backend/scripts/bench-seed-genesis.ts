/**
 * scripts/bench-seed-genesis.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Seed a registry the size of HCMC's cadastre and build its tree (D72, Chapter 5).
 *
 * ⚠️ BENCH ONLY. Every `ownerSecret` here is derived from a FIXED PUBLIC SEED —
 * `poseidon([BENCH_SECRET_SEED, propertyId])` — so anyone who reads this file
 * can compute the secret of any plot. That is deliberate: a harness has to be
 * able to prove ownership of 2.5 million plots without storing 2.5 million
 * secrets. It is also exactly what D14 forbids on a real deployment. The script
 * refuses to run against a non-empty `properties` table, which is the only
 * guard that matters.
 *
 * ⚠️ POINT IT AT ITS OWN DATABASE. 2.5M plots is ~1.5 GB of `merkle_nodes`
 * alone, and the script TRUNCATEs the tree. Create a separate database and pass
 * it in, rather than aiming this at the development one:
 *
 *   docker exec land_registry_postgres createdb -U postgres land_registry_bench
 *   export BENCH_DB="postgresql://postgres:postgres@localhost:5433/land_registry_bench?schema=public"
 *   DATABASE_URL=$BENCH_DB pnpm --filter backend prisma migrate deploy
 *   DATABASE_URL=$BENCH_DB COUNT=2500000 pnpm --filter backend run bench:seed
 *
 * ⚠️ Writes straight into `properties` with raw SQL, NOT through ImportService.
 * A genesis models "cadastral data that already exists"; it does not model the
 * import flow, whose throughput is measured separately.
 *
 * ⚠️ `updatedAt` must be written explicitly. Prisma's `@updatedAt` is applied by
 * the client, not by a column default, so a raw INSERT that omits it violates
 * NOT NULL.
 *
 * Usage:
 *   COUNT=2500000 LAYOUT=scattered pnpm --filter backend run bench:seed
 *   COUNT=100000  LAYOUT=contiguous pnpm --filter backend run bench:seed
 */
import * as fs from 'fs';
import * as path from 'path';

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import * as dotenv from 'dotenv';
import { MAX_PROPERTY_ID, poseidonHash } from '@land-registry/blockchain/shared';
import { TREE_DEPTH } from '@land-registry/blockchain/shared/treeDimensions';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

import { AppModule } from '../src/app.module';
import { NodeStoreService } from '../src/tree/node-store.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Seed behind every bench secret. Public on purpose — see the file header. */
export const BENCH_SECRET_SEED = 424_242n;

/** The owner secret of a bench plot, recomputable from any script. */
export async function benchOwnerSecret(propertyId: bigint): Promise<bigint> {
  return poseidonHash([BENCH_SECRET_SEED, propertyId]);
}

const COUNT = Number(process.env.COUNT ?? 2_500_000);
const LAYOUT = (process.env.LAYOUT ?? 'scattered') as 'scattered' | 'contiguous';

/**
 * Rows per INSERT. Each row binds 16 parameters and PostgreSQL accepts 65,535
 * per statement, so 2,000 rows (32,000 parameters) stays well inside the limit.
 */
const INSERT_CHUNK = 2_000;

/**
 * Where a plot's id sits in the address space.
 *
 * `scattered` is the real case — cadastral parcel numbers are not contiguous —
 * and the bad case for the node table: neighbouring leaves rarely share a
 * parent low in the tree, so more nodes have to be stored. A fixed stride
 * rather than randomness, so every run produces exactly the same layout: a
 * benchmark that cannot be reproduced is not data.
 */
function propertyIdAt(index: number): bigint {
  if (LAYOUT === 'contiguous') return BigInt(index + 1);
  const stride = (MAX_PROPERTY_ID + 1n) / BigInt(COUNT);
  return BigInt(index) * stride + 1n;
}

const USE_TYPES = ['RESIDENTIAL', 'AGRICULTURAL', 'COMMERCIAL', 'INDUSTRIAL', 'FORESTRY'];
/** Mostly FREE, like the real register — and like generateMockData's mix. */
const ENCUMBRANCES = ['FREE', 'FREE', 'FREE', 'FREE', 'MORTGAGED', 'LITIGATED', 'RESTRICTED'];

async function main(): Promise<void> {
  if (BigInt(COUNT) > MAX_PROPERTY_ID + 1n) {
    throw new Error(
      `COUNT ${COUNT} exceeds the addressable range 0..${MAX_PROPERTY_ID} of a ` +
        `depth-${TREE_DEPTH} tree (D71)`,
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, { abortOnError: false });
  const prisma = app.get(PrismaService);
  const nodes = app.get(NodeStoreService);

  const existing = await prisma.property.count();
  if (existing > 0) {
    throw new Error(
      `properties already holds ${existing} row(s). This script refuses to touch a non-empty ` +
        `registry: its owner secrets come from a public seed (see the file header). Point ` +
        `DATABASE_URL at a dedicated bench database.`,
    );
  }

  console.log(`  seeding ${COUNT.toLocaleString('en-US')} plots (${LAYOUT}), depth ${TREE_DEPTH}`);

  const now = new Date();
  const nowIso = now.toISOString();
  const rowsStart = Date.now();

  for (let from = 0; from < COUNT; from += INSERT_CHUNK) {
    const to = Math.min(from + INSERT_CHUNK, COUNT);
    const values: Prisma.Sql[] = [];

    for (let i = from; i < to; i++) {
      const propertyId = propertyIdAt(i);
      const commitment = await poseidonHash([await benchOwnerSecret(propertyId)]);
      const perpetual = i % 3 === 0;

      values.push(Prisma.sql`(
        ${propertyId.toString()},
        ${commitment.toString()},
        ${USE_TYPES[i % USE_TYPES.length]}::"UseType",
        ${perpetual ? '0' : String(Math.floor(now.getTime() / 1000) + 20 * 365 * 24 * 3600)},
        ${ENCUMBRANCES[i % ENCUMBRANCES.length]}::"EncumbranceStatus",
        ${perpetual ? 'PERPETUAL' : 'FIXED_TERM'}::"TenureType",
        ${'ONT'},
        ${`BENCH-${propertyId}`},
        ${`BK-${propertyId}`},
        ${`So ${propertyId}, Phuong Sai Gon, Thanh pho Ho Chi Minh`},
        ${(100 + (i % 400)).toFixed(2)}::decimal,
        ${'Van phong Dang ky dat dai Thanh pho Ho Chi Minh'},
        ${nowIso}::date,
        ${'ISSUED'}::"PropertyStatus",
        ${nowIso}::timestamp,
        ${nowIso}::timestamp
      )`);
    }

    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO properties (
        "propertyId", "ownerCommitment", "useType", "validityPeriod", "encumbranceStatus",
        "tenureType", "landUseCode", "certificateSerial", "bookEntryNumber", "address",
        "area", "issuingAuthority", "issueDate", "status", "createdAt", "updatedAt"
      ) VALUES ${Prisma.join(values)}`,
    );

    if (to % 100_000 === 0 || to === COUNT) {
      const elapsed = ((Date.now() - rowsStart) / 1000).toFixed(0);
      console.log(`  rows: ${to.toLocaleString('en-US')} / ${COUNT.toLocaleString('en-US')}  (${elapsed}s)`);
    }
  }

  const rowsMs = Date.now() - rowsStart;
  console.log(`  rows inserted in ${(rowsMs / 1000).toFixed(1)}s — building the tree…`);

  const bootstrapStart = Date.now();
  const tree = await nodes.bootstrap((stage, count) =>
    console.log(`  ${stage}: ${count.toLocaleString('en-US')}`),
  );
  const bootstrapMs = Date.now() - bootstrapStart;

  const [size] = await prisma.$queryRaw<{ pretty: string }[]>(
    Prisma.sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty`,
  );

  const report = {
    kind: 'seed' as const,
    at: new Date().toISOString(),
    // Every number below is meaningless without the depth it was measured at.
    treeDepth: TREE_DEPTH,
    count: COUNT,
    layout: LAYOUT,
    rowsMs,
    bootstrapMs,
    leaves: tree.leaves,
    nodes: tree.nodes,
    root: tree.root.toString(),
    databaseSize: size?.pretty ?? 'unknown',
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpus: require('os').cpus().length,
      totalMemGb: Math.round(require('os').totalmem() / 1024 ** 3),
      node: process.version,
    },
  };

  const dir = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'blockchain',
    'bench',
    'results',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'seed.json'), JSON.stringify(report, null, 2));

  console.log('');
  console.log(`  leaves    : ${tree.leaves.toLocaleString('en-US')}`);
  console.log(`  nodes     : ${tree.nodes.toLocaleString('en-US')}`);
  console.log(`  root      : ${tree.root}`);
  console.log(`  rows      : ${(rowsMs / 1000).toFixed(1)}s`);
  console.log(`  bootstrap : ${(bootstrapMs / 1000).toFixed(1)}s`);
  console.log(`  db size   : ${report.databaseSize}`);
  console.log(`  report    : ${dir}`);
  console.log('');
  console.log('  Publish this root before measuring anything else:');
  console.log(`    NEW_ROOT=${tree.root} pnpm --filter blockchain run sign:root`);

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
