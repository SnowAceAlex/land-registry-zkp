/**
 * scripts/seed-admin-units.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads the commune-level administrative catalog (phường / xã / đặc khu) from an
 * official export into the `administrative_units` table.
 *
 * The catalog is reference data with a legal source — it is seeded from a file
 * you supply, never invented here. Until it is seeded the importer cannot
 * verify that a ward exists and reports that openly rather than guessing.
 *
 * Usage:
 *   pnpm --filter backend run seed:admin-units <file.csv|file.json> [--province "TP.HCM"]
 *   pnpm --filter backend run seed:admin-units <file> --replace   # wipe first
 *
 * Accepted shapes — column names are matched case-insensitively:
 *   CSV   name|ten|tenDonViHanhChinh , type|loai , province|tinh , code|ma
 *   JSON  [{ "name": "Sài Gòn", "type": "PHUONG", "province": "TP.HCM" }]
 *
 * Only `name` is required. `type` is inferred from a "Phường "/"Xã " prefix on
 * the name when the column is absent; `province` falls back to --province.
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as Papa from 'papaparse';
import { AdministrativeUnitType, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

interface UnitRow {
  name: string;
  type: AdministrativeUnitType;
  province: string;
  code?: string;
}

const NAME_KEYS = ['name', 'ten', 'tendonvihanhchinh', 'tenphuongxa', 'tendonvi'];
const TYPE_KEYS = ['type', 'loai', 'loaihinh', 'capdonvi'];
const PROVINCE_KEYS = ['province', 'tinh', 'tinhthanhpho', 'tentinh'];
const CODE_KEYS = ['code', 'ma', 'madonvi', 'masodonvihanhchinh', 'masodvhc'];

function normaliseKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Finds a value by any accepted alias. Exact match first; a prefix match then
 * catches the long headers these exports use, e.g.
 * "Mã số ĐVHC (theo Quyết định 19/2025/QĐ-TTg)" for `ma`.
 */
function pickColumn(row: Record<string, string>, keys: string[]): string | undefined {
  const entries = Object.entries(row).map(
    ([key, value]) => [normaliseKey(key), value] as const,
  );

  for (const key of keys) {
    const exact = entries.find(([column]) => column === key);
    if (exact?.[1]?.trim()) return exact[1].trim();
  }
  for (const key of keys) {
    const prefixed = entries.find(([column]) => column.startsWith(key));
    if (prefixed?.[1]?.trim()) return prefixed[1].trim();
  }
  return undefined;
}

/** Reports which source column each field was read from, so a mismatch is visible. */
function describeMapping(row: Record<string, string>): string[] {
  const columns = Object.keys(row);
  const find = (keys: string[]) => {
    const exact = columns.find((column) => keys.includes(normaliseKey(column)));
    if (exact) return exact;
    return columns.find((column) => keys.some((key) => normaliseKey(column).startsWith(key)));
  };
  return [
    `name     ← ${find(NAME_KEYS) ?? '(not found)'}`,
    `type     ← ${find(TYPE_KEYS) ?? '(inferred from the name prefix)'}`,
    `province ← ${find(PROVINCE_KEYS) ?? '(from --province)'}`,
    `code     ← ${find(CODE_KEYS) ?? '(none)'}`,
  ];
}

function findHeaderOffset(content: string): number {
  const lines = content.split(/\r?\n/).slice(0, 15);
  for (let index = 0; index < lines.length; index++) {
    const columns = lines[index].split(',').map(normaliseKey);
    const hasName = columns.some(
      (column) => NAME_KEYS.includes(column) || NAME_KEYS.some((key) => column.startsWith(key)),
    );
    if (hasName) return index;
  }
  return 0;
}

function parseType(raw: string | undefined, name: string): AdministrativeUnitType {
  const value = (raw ?? '').trim().toLowerCase();
  if (value.includes('đặc khu') || value.includes('dac khu') || value === 'dac_khu') {
    return AdministrativeUnitType.DAC_KHU;
  }
  if (value.includes('xã') || value.includes('xa')) return AdministrativeUnitType.XA;
  if (value.includes('phường') || value.includes('phuong')) return AdministrativeUnitType.PHUONG;

  // No type column: read it off the name prefix, which every official list carries.
  if (/^xã\s/i.test(name)) return AdministrativeUnitType.XA;
  if (/^đặc\s*khu\s/i.test(name)) return AdministrativeUnitType.DAC_KHU;
  return AdministrativeUnitType.PHUONG;
}

/** Strips the tier prefix so the stored name matches what an address contains. */
function stripPrefix(name: string): string {
  return name.replace(/^(Phường|Xã|Đặc\s*khu)\s+/i, '').trim();
}

function toUnits(raw: Record<string, string>[], defaultProvince?: string): UnitRow[] {
  const units: UnitRow[] = [];
  const problems: string[] = [];

  raw.forEach((row, index) => {
    const rawName = pickColumn(row, NAME_KEYS);
    if (!rawName) {
      problems.push(`row ${index + 2}: no name column (looked for ${NAME_KEYS.join('/')})`);
      return;
    }
    const province = pickColumn(row, PROVINCE_KEYS) ?? defaultProvince;
    if (!province) {
      problems.push(`row ${index + 2}: no province column and --province was not given`);
      return;
    }
    units.push({
      name: stripPrefix(rawName),
      type: parseType(pickColumn(row, TYPE_KEYS), rawName),
      province: province.trim(),
      code: pickColumn(row, CODE_KEYS),
    });
  });

  if (problems.length > 0) {
    // Fail loudly on a shape mismatch: a half-loaded catalog would reject real
    // addresses later, far from the cause.
    throw new Error(
      `Could not read ${problems.length} row(s):\n  ${problems.slice(0, 10).join('\n  ')}` +
      (problems.length > 10 ? `\n  … and ${problems.length - 10} more` : '') +
      `\n\nColumns seen: ${Object.keys(raw[0] ?? {}).join(', ')}`,
    );
  }
  return units;
}

function readFile(filePath: string, defaultProvince?: string): UnitRow[] {
  const content = fs.readFileSync(filePath, 'utf8');

  if (path.extname(filePath).toLowerCase() === '.json') {
    const parsed = JSON.parse(content);
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.units);
    if (!Array.isArray(rows)) {
      throw new Error('JSON must be an array, or an object with a "data"/"units" array');
    }
    return toUnits(rows, defaultProvince);
  }

  const headerOffset = findHeaderOffset(content);
  if (headerOffset > 0) {
    console.log(`Header found on line ${headerOffset + 1}; skipping the ${headerOffset} line(s) above it.`);
  }
  const body = content.split(/\r?\n/).slice(headerOffset).join('\n');

  const parsed = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(`Could not parse the CSV: ${parsed.errors[0].message}`);
  }

  if (parsed.data[0]) {
    console.log('Column mapping:');
    for (const line of describeMapping(parsed.data[0])) console.log(`  ${line}`);
  }
  return toUnits(parsed.data, defaultProvince);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filePath = args.find((arg) => !arg.startsWith('--'));
  if (!filePath) {
    throw new Error(
      'Usage: seed:admin-units <file.csv|file.json> [--province "TP.HCM"] [--replace]',
    );
  }
  const provinceIndex = args.indexOf('--province');
  const defaultProvince = provinceIndex >= 0 ? args[provinceIndex + 1] : undefined;
  const replace = args.includes('--replace');

  const units = readFile(path.resolve(filePath), defaultProvince);
  if (units.length === 0) {
    throw new Error('The file produced no rows');
  }

  console.log(`Parsed ${units.length} unit(s) from ${filePath}`);
  console.log('First 5 as understood:');
  for (const unit of units.slice(0, 5)) {
    console.log(`  ${unit.type.padEnd(8)} "${unit.name}" — ${unit.province}`);
  }

  const byProvince = units.reduce<Record<string, number>>((acc, unit) => {
    acc[unit.province] = (acc[unit.province] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Per province:', byProvince);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) });

  try {
    if (replace) {
      const { count } = await prisma.administrativeUnit.deleteMany({});
      console.log(`Removed ${count} existing row(s) (--replace)`);
    }

    const { count } = await prisma.administrativeUnit.createMany({
      data: units,
      skipDuplicates: true,
    });
    const total = await prisma.administrativeUnit.count();
    console.log(`Inserted ${count} new row(s); catalog now holds ${total}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
