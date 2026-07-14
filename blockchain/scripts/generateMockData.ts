/**
 * scripts/generateMockData.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 0 — generates N mock LURRecord + matching ownerSecret pairs for use
 * across every later phase (Merkle tests, circuit witness tests, dev seeding).
 *
 * `generateMockRecords()` is a pure, reusable function (imported directly by
 * Phase 1 tests — no file I/O dependency). Running this file directly (CLI)
 * additionally writes JSON fixtures to blockchain/fixtures/ (gitignored,
 * since mockSecrets.json holds ownerSecret private key material).
 *
 * Usage: pnpm --filter blockchain run mock:generate [count]
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { nowUnixTimestamp, toUnixTimestamp } from '../shared/datetime';
import { poseidonHash } from '../shared/merkleTree';
import { EncumbranceStatus, LURRecord, TenureType, UseType } from '../shared/types';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

function randomEnumValue<T extends Record<string, number | string>>(enumObj: T): T[keyof T] {
  const values = Object.values(enumObj).filter((v) => typeof v === 'number') as number[];
  const pick = values[Math.floor(Math.random() * values.length)];
  return pick as T[keyof T];
}

/** Random field element strictly below the BN254 scalar field size. */
function randomFieldElement(): bigint {
  // 31 bytes (248 bits) is comfortably below the ~254-bit field modulus.
  return BigInt('0x' + randomBytes(31).toString('hex'));
}

function randomEncumbranceStatus(): EncumbranceStatus {
  // Mostly FREE, occasionally something else — more realistic than uniform random.
  const roll = Math.random();
  if (roll < 0.7) return EncumbranceStatus.FREE;
  return randomEnumValue(EncumbranceStatus);
}

export interface MockDataResult {
  records: LURRecord[];
  secrets: Map<bigint, bigint>;
}

/**
 * Generate `count` mock LUR records with matching ownerSecret values.
 * ownerCommitment = Poseidon([ownerSecret]) — reuses the shared hashing
 * logic, never duplicated here.
 */
export async function generateMockRecords(count: number): Promise<MockDataResult> {
  const records: LURRecord[] = [];
  const secrets = new Map<bigint, bigint>();
  const now = nowUnixTimestamp();

  for (let i = 1; i <= count; i++) {
    const propertyId = BigInt(i);
    const ownerSecret = randomFieldElement();
    const ownerCommitment = await poseidonHash([ownerSecret]);
    const tenureType = randomEnumValue(TenureType);

    const validityPeriod =
      tenureType === TenureType.PERPETUAL
        ? 0n // sentinel per D5
        : now + BigInt(Math.floor(Math.random() * 50 + 1) * SECONDS_PER_YEAR);

    const record: LURRecord = {
      propertyId,
      ownerCommitment,
      useType: randomEnumValue(UseType),
      validityPeriod,
      encumbranceStatus: randomEncumbranceStatus(),
      tenureType,
    };

    records.push(record);
    secrets.set(propertyId, ownerSecret);
  }

  return { records, secrets };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI runner — writes fixtures to blockchain/fixtures/ (gitignored)
// ─────────────────────────────────────────────────────────────────────────────

function serializeRecord(record: LURRecord): Record<string, string | number> {
  return {
    propertyId: record.propertyId.toString(),
    ownerCommitment: record.ownerCommitment.toString(),
    useType: record.useType,
    validityPeriod: record.validityPeriod.toString(),
    encumbranceStatus: record.encumbranceStatus,
    tenureType: record.tenureType,
  };
}

async function main() {
  const count = Number(process.argv[2]) || 20;
  const { records, secrets } = await generateMockRecords(count);

  const fixturesDir = path.resolve(__dirname, '../fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });

  const recordsPath = path.join(fixturesDir, 'mockRecords.json');
  fs.writeFileSync(recordsPath, JSON.stringify(records.map(serializeRecord), null, 2));

  const secretsPath = path.join(fixturesDir, 'mockSecrets.json');
  const secretsObj: Record<string, string> = {};
  for (const [propertyId, secret] of secrets) {
    secretsObj[propertyId.toString()] = secret.toString();
  }
  fs.writeFileSync(secretsPath, JSON.stringify(secretsObj, null, 2));

  console.log(`Generated ${count} mock records:`);
  console.log(`  ${recordsPath}`);
  console.log(`  ${secretsPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
