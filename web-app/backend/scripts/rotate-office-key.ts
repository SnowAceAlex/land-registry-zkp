/**
 * scripts/rotate-office-key.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * D85: revokes an office's active keys and issues a new one, printed once.
 *
 * Usage: pnpm --filter backend run office:rotate-key <CODE>   e.g. CN07
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { generateOfficeKey, hashOfficeKey } from '../src/offices/office-key';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

async function main(): Promise<void> {
  const code = process.argv[2];
  if (!code) throw new Error('Usage: office:rotate-key <CODE>');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) });

  try {
    const office = await prisma.landOffice.findUnique({ where: { code } });
    if (!office) throw new Error(`No office with code '${code}'`);

    const key = generateOfficeKey();
    const [revoked] = await prisma.$transaction([
      prisma.officeCredential.updateMany({
        where: { officeId: office.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.officeCredential.create({
        data: { officeId: office.id, keyHash: hashOfficeKey(key) },
      }),
    ]);
    console.log(`Revoked ${revoked.count} active key(s) of ${code}.`);
    console.log(`${code}\t${key}`);
    console.log('Store this key now — only its hash is kept.');
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
