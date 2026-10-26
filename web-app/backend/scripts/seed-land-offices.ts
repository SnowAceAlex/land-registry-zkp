/**
 * scripts/seed-land-offices.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * D85: loads the land office catalog (3 central + 38 branches), assigns every
 * commune to its branch, backfills Property.landOfficeId from the address and
 * creates the first access key of each office. Safe to re-run.
 *
 * Usage: pnpm --filter backend run seed:land-offices [file]
 *        (default seed/land-offices.hcmc.json)
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { communeNameOf, normaliseUnitName } from '../src/land-law/administrative-units.service';
import { parseLandOfficeFile, planUnitAssignment } from '../src/offices/land-office-catalog';
import { generateOfficeKey, hashOfficeKey } from '../src/offices/office-key';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const PAGE = 5000;

async function main(): Promise<void> {
  const filePath = path.resolve(
    process.argv[2] ?? path.join(__dirname, '..', 'seed', 'land-offices.hcmc.json'),
  );
  const file = parseLandOfficeFile(JSON.parse(fs.readFileSync(filePath, 'utf8')));

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) });

  try {
    const catalog = await prisma.administrativeUnit.findMany({
      where: { province: file.province },
      select: { id: true, name: true, type: true },
    });
    const plan = planUnitAssignment(file, catalog);

    if (plan.missingInCatalog.length > 0 || plan.unassignedInCatalog.length > 0) {
      console.error(`Not seeding: the file and administrative_units disagree (${file.province}).`);
      console.error('In the file but not in the catalog:', plan.missingInCatalog);
      console.error('In the catalog but in no branch:', plan.unassignedInCatalog);
      process.exitCode = 1;
      return;
    }
    for (const warning of plan.typeMismatches) console.warn(`type mismatch — ${warning}`);

    const offices = [
      ...file.central.map(({ code, name, kind }) => ({ code, name, kind })),
      ...file.branches.map(({ code, name }) => ({ code, name, kind: 'BRANCH' as const })),
    ];
    const unitsByOffice = new Map<string, number[]>();
    for (const { unitId, officeCode } of plan.assignments) {
      unitsByOffice.set(officeCode, [...(unitsByOffice.get(officeCode) ?? []), unitId]);
    }

    await prisma.$transaction(async (tx) => {
      for (const office of offices) {
        await tx.landOffice.upsert({
          where: { code: office.code },
          update: { name: office.name, kind: office.kind },
          create: office,
        });
      }
      const rows = await tx.landOffice.findMany({ select: { id: true, code: true } });
      const idOf = new Map(rows.map((row) => [row.code, row.id]));
      for (const [code, unitIds] of unitsByOffice) {
        await tx.administrativeUnit.updateMany({
          where: { id: { in: unitIds } },
          data: { landOfficeId: idOf.get(code) },
        });
      }
    });
    console.log(
      `Upserted ${offices.length} offices; assigned ${plan.assignments.length} communes.`,
    );

    // Property -> office, by the commune named in the address.
    const officeRows = await prisma.landOffice.findMany({ select: { id: true, code: true } });
    const officeIdByCode = new Map(officeRows.map((row) => [row.code, row.id]));
    const unitById = new Map(catalog.map((unit) => [unit.id, unit]));
    const officeIdByUnit = new Map<string, number>();
    for (const { unitId, officeCode } of plan.assignments) {
      officeIdByUnit.set(
        normaliseUnitName(unitById.get(unitId).name),
        officeIdByCode.get(officeCode),
      );
    }

    const perOffice = new Map<number, number>();
    let unassigned = 0;
    let cursor: number | undefined;
    for (;;) {
      const page = await prisma.property.findMany({
        select: { id: true, address: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;

      const grouped = new Map<number, number[]>();
      for (const { id, address } of page) {
        const commune = communeNameOf(address);
        const officeId = commune ? officeIdByUnit.get(normaliseUnitName(commune)) : undefined;
        if (officeId === undefined) {
          unassigned++;
          continue;
        }
        grouped.set(officeId, [...(grouped.get(officeId) ?? []), id]);
      }
      for (const [landOfficeId, ids] of grouped) {
        await prisma.property.updateMany({ where: { id: { in: ids } }, data: { landOfficeId } });
        perOffice.set(landOfficeId, (perOffice.get(landOfficeId) ?? 0) + ids.length);
      }
    }
    for (const [code, id] of officeIdByCode) {
      if (perOffice.has(id)) console.log(`  ${code}: ${perOffice.get(id)} propert(ies)`);
    }
    console.log(`Properties without an office (address did not resolve): ${unassigned}`);

    let created = 0;
    for (const [code, officeId] of officeIdByCode) {
      const active = await prisma.officeCredential.count({ where: { officeId, revokedAt: null } });
      if (active > 0) continue;
      const key = generateOfficeKey();
      await prisma.officeCredential.create({ data: { officeId, keyHash: hashOfficeKey(key) } });
      // Printed at once: if a later office fails, the keys already stored are not lost.
      console.log(`${code}\t${key}`);
      created++;
    }
    console.log(
      created > 0
        ? 'Store these keys now — only their hashes are kept.'
        : 'Every office already has an active key; none created.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
