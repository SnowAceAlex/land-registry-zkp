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

import { fromUnixTimestamp, nowUnixTimestamp } from '../shared/datetime';
import { poseidonHash } from '../shared/merkleTree';
import { hashOffchainMetadata } from '../shared/offchainMetadata';
import { EncumbranceStatus, LURRecord, TenureType, UseType } from '../shared/types';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/** Digest of an all-empty descriptor — mock records have no certificate metadata. */
const EMPTY_OFFCHAIN_HASH = hashOffchainMetadata({
  landUseCode: '',
  landUserType: null,
  certificateSerial: '',
  bookEntryNumber: '',
  mapSheetNumber: null,
  landOrigin: null,
  address: '',
  area: '0.00',
  issuingAuthority: '',
  issueDate: '1970-01-01',
});

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
      // Mock records carry no certificate metadata, so they commit to the
      // digest of an empty descriptor rather than fabricating one.
      offchainHash: EMPTY_OFFCHAIN_HASH,
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

const IMPORT_CSV_COLUMNS = [
  'propertyId',
  'landUseCode',
  'tenureType',
  'landUserType',
  'culturalPreservation',
  'certificateSerial',
  'bookEntryNumber',
  'mapSheetNumber',
  'landOrigin',
  'address',
  'area',
  'issuingAuthority',
  'issueDate',
  'expiryDate',
  'encumbranceStatus',
] as const;

/**
 * Land codes of Phụ lục II TT 08/2024 that the backend map accepts, with the
 * tenure/holder combination each one is generated under. Kept explicit rather
 * than random so every row satisfies the statutory-term validation:
 *   - FIXED_TERM held by an individual is exactly 50 years (Điều 172 khoản 1 điểm a)
 *   - PROJECT_LEASEHOLD is capped at 50 years (điểm c)
 *   - PERPETUAL carries no expiry date at all (D5)
 */
const LAND_PROFILES = [
  {
    code: 'ONT',
    tenure: 'PERPETUAL',
    userType: '',
    origin: 'Nhà nước công nhận quyền sử dụng đất',
  },
  {
    code: 'ODT',
    tenure: 'PERPETUAL',
    userType: '',
    origin: 'Nhà nước công nhận quyền sử dụng đất',
  },
  {
    code: 'LUC',
    tenure: 'FIXED_TERM',
    userType: 'CNV',
    origin: 'Nhà nước giao đất không thu tiền sử dụng đất',
  },
  {
    code: 'LUK',
    tenure: 'FIXED_TERM',
    userType: 'CNV',
    origin: 'Nhà nước giao đất không thu tiền sử dụng đất',
  },
  {
    code: 'CLN',
    tenure: 'FIXED_TERM',
    userType: 'CNV',
    origin: 'Nhà nước công nhận quyền sử dụng đất',
  },
  {
    code: 'HNK',
    tenure: 'FIXED_TERM',
    userType: 'CNV',
    origin: 'Nhà nước giao đất không thu tiền sử dụng đất',
  },
  {
    code: 'CNT',
    tenure: 'FIXED_TERM',
    userType: 'CNV',
    origin: 'Nhà nước cho thuê đất trả tiền hằng năm',
  },
  {
    code: 'NTS',
    tenure: 'FIXED_TERM',
    userType: 'CNV',
    origin: 'Nhà nước giao đất không thu tiền sử dụng đất',
  },
  {
    code: 'LMU',
    tenure: 'FIXED_TERM',
    userType: 'CNV',
    origin: 'Nhà nước giao đất không thu tiền sử dụng đất',
  },
  // Điều 171 khoản 3 — production forest is perpetual only for a body assigned
  // to manage it, not for an economic organisation producing on it.
  {
    code: 'RSX',
    tenure: 'PERPETUAL',
    userType: 'TCN',
    origin: 'Nhà nước giao đất không thu tiền sử dụng đất',
  },
  // Natural production forest — a separate code from planted forest (RSX).
  {
    code: 'RSN',
    tenure: 'FIXED_TERM',
    userType: 'TKT',
    origin: 'Nhà nước cho thuê đất trả tiền hằng năm',
  },
  {
    code: 'TMD',
    tenure: 'PROJECT_LEASEHOLD',
    userType: 'TKT',
    origin: 'Nhà nước cho thuê đất trả tiền một lần',
  },
  // Điều 171 khoản 4 — commercial land recognised for an individual is perpetual.
  {
    code: 'SKC',
    tenure: 'PERPETUAL',
    userType: 'CNV',
    origin: 'Nhà nước công nhận quyền sử dụng đất',
  },
  {
    code: 'SKK',
    tenure: 'PROJECT_LEASEHOLD',
    userType: 'TKT',
    origin: 'Nhà nước cho thuê đất trả tiền một lần',
  },
  // Điều 171 khoản 2 → Điều 178 khoản 4 — community land is perpetual only when
  // it is held to preserve ethnic cultural identity.
  {
    code: 'CLN',
    tenure: 'PERPETUAL',
    userType: 'CDS',
    origin: 'Nhà nước giao đất không thu tiền sử dụng đất',
    culturalPreservation: true,
  },
] as const;

const ENCUMBRANCE_VALUES = ['FREE', 'MORTGAGED', 'LITIGATED', 'RESTRICTED'] as const;

const URBAN_LOCATIONS = [
  { street: 'Đường Nguyễn Huệ', ward: 'Phường Sài Gòn' },
  { street: 'Đường Lê Lợi', ward: 'Phường Sài Gòn' },
  { street: 'Đường Hai Bà Trưng', ward: 'Phường Tân Định' },
  { street: 'Đường Điện Biên Phủ', ward: 'Phường Bình Thạnh' },
  { street: 'Đường Võ Văn Ngân', ward: 'Phường Thủ Đức' },
] as const;

/** Agricultural and forestry parcels belong in the outlying communes, not downtown. */
const RURAL_LOCATIONS = [
  { street: 'Ấp Phú Hòa', ward: 'Xã Phú Hòa Đông' },
  { street: 'Ấp Tân Tiến', ward: 'Xã Tân An Hội' },
  { street: 'Ấp Bình Hữu', ward: 'Xã Bình Mỹ' },
  { street: 'Ấp Thới Tây', ward: 'Xã Xuân Thới Sơn' },
  { street: 'Ấp Rạch Lá', ward: 'Xã An Thới Đông' },
] as const;

const URBAN_CODES = ['ONT', 'ODT', 'TMD', 'SKC', 'SKK'];

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildImportCsv(count: number): string {
  const now = nowUnixTimestamp();
  const lines: string[] = [IMPORT_CSV_COLUMNS.join(',')];

  for (let i = 1; i <= count; i++) {
    const profile = LAND_PROFILES[(i - 1) % LAND_PROFILES.length];
    const isPerpetual = profile.tenure === 'PERPETUAL';

    // Issued 1–10 years ago, on a real calendar day.
    const issuedAt = now - BigInt(Math.floor(Math.random() * 10 + 1) * SECONDS_PER_YEAR);

    // The term is dictated by law, not chosen: exactly 50 years for an
    // individual's fixed term, ≤50 for a project lease. A random span would be
    // rejected by the importer's statutory-term check — as it should be.
    let expiry = '';
    if (!isPerpetual) {
      const fiftyYearCodes = ['LUC', 'LUK', 'CLN', 'HNK', 'NTS', 'LMU', 'RSX'];
      const years =
        profile.tenure === 'FIXED_TERM' && fiftyYearCodes.includes(profile.code)
          ? 50
          : Math.floor(Math.random() * 20 + 30);
      expiry = fromUnixTimestamp(issuedAt + BigInt(years * SECONDS_PER_YEAR));
    }

    const location = URBAN_CODES.includes(profile.code)
      ? pick(URBAN_LOCATIONS)
      : pick(RURAL_LOCATIONS);
    const houseNumber = URBAN_CODES.includes(profile.code) ? `Số ${i * 3}, ` : '';

    const row: Record<(typeof IMPORT_CSV_COLUMNS)[number], string> = {
      propertyId: String(i),
      landUseCode: profile.code,
      tenureType: profile.tenure,
      landUserType: profile.userType,
      culturalPreservation:
        'culturalPreservation' in profile && profile.culturalPreservation ? 'true' : '',
      certificateSerial: `CT ${String(100000 + i)}`,
      bookEntryNumber: `CS${String(20000 + i)}`,
      mapSheetNumber: String(((i - 1) % 40) + 1),
      landOrigin: profile.origin,
      address: `${houseNumber}${location.street}, ${location.ward}, TP.HCM`,
      area: (Math.random() * 400 + 50).toFixed(2),
      // Renamed from "Sở Tài nguyên và Môi trường" on 01/5/2025.
      issuingAuthority: 'Sở Nông nghiệp và Môi trường TP.HCM',
      issueDate: fromUnixTimestamp(issuedAt),
      expiryDate: expiry,
      encumbranceStatus: i <= 3 ? 'FREE' : ENCUMBRANCE_VALUES[(i - 4) % ENCUMBRANCE_VALUES.length],
    };

    lines.push(IMPORT_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(','));
  }

  return lines.join('\n') + '\n';
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

  // Phase 5 demo input for POST /api/government/import
  const importCsvPath = path.join(fixturesDir, 'mockImport.csv');
  fs.writeFileSync(importCsvPath, buildImportCsv(count), 'utf8');

  console.log(`Generated ${count} mock records:`);
  console.log(`  ${recordsPath}`);
  console.log(`  ${secretsPath}`);
  console.log(`  ${importCsvPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
