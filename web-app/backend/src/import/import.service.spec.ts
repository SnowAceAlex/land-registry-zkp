import { Prisma } from '@prisma/client';

import { ImportService, parseVietnameseDate } from './import.service';
import { AdministrativeUnitsService } from '../land-law/administrative-units.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The DB is stubbed: these tests are about row validation and the derivations
 * that end up inside an immutable leaf hash, not about Prisma.
 */
/** Commune-level units the address tests resolve against, standing in for the seeded catalog. */
const CATALOG = ['Sài Gòn', 'Tân Định', 'Bình Mỹ'];

function makeService({ catalog = CATALOG }: { catalog?: string[] } = {}) {
  const createMany = jest.fn(async ({ data }: { data: Prisma.PropertyCreateManyInput[] }) => ({
    count: data.length,
  }));
  const findMany = jest.fn(async () => catalog.map((name) => ({ name })));
  const prisma = {
    property: { createMany },
    administrativeUnit: { findMany },
  } as unknown as PrismaService;

  // Reads the MOST RECENT call: several tests import a rejected file first and
  // a valid one second, and pinning to call 0 would assert against the reject.
  const created = () => createMany.mock.calls[createMany.mock.calls.length - 1][0].data;
  const service = new ImportService(prisma, new AdministrativeUnitsService(prisma));
  return { service, createMany, created };
}

const COLUMNS = [
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
  'isLongTermInvestmentProject',
] as const;

const HEADER = COLUMNS.join(',');

/** 50 years after 15/01/2016 — the statutory term for an individual (Điều 172). */
const FIFTY_YEARS_LATER = '15/01/2066';

function row(overrides: Partial<Record<(typeof COLUMNS)[number], string>> = {}): string {
  const values: Record<(typeof COLUMNS)[number], string> = {
    propertyId: '1',
    landUseCode: 'ONT',
    tenureType: '',
    landUserType: '',
    culturalPreservation: '',
    certificateSerial: 'CT 100001',
    bookEntryNumber: 'CS20001',
    mapSheetNumber: '12',
    landOrigin: 'Nhà nước công nhận quyền sử dụng đất',
    // Two-tier address (no district) — the structure in force since 01/7/2025.
    address: 'Số 3, Đường Lê Lợi, Phường Sài Gòn, TP.HCM',
    area: '120.50',
    issuingAuthority: 'Sở Nông nghiệp và Môi trường TP.HCM',
    issueDate: '15/01/2016',
    expiryDate: '',
    encumbranceStatus: 'FREE',
    isLongTermInvestmentProject: '',
    ...overrides,
  };
  // Quoted because a comma inside an address or a thousands separator would
  // otherwise split the column — which is how a real spreadsheet export writes it.
  return COLUMNS.map((column) => `"${values[column]}"`).join(',');
}

describe('ImportService', () => {
  it('derives useType from landUseCode rather than trusting the file (D2)', async () => {
    const { service, created } = makeService();

    await service.importCsv(
      [
        HEADER,
        row({ landUseCode: 'RSX', landUserType: 'CNV', expiryDate: FIFTY_YEARS_LATER }),
      ].join('\n'),
    );

    expect(created()[0]).toMatchObject({
      useType: 'FORESTRY',
      tenureType: 'FIXED_TERM',
      landUseCode: 'RSX',
    });
  });

  it('imports perpetual land with the 0 sentinel instead of a date (D5)', async () => {
    const { service, created } = makeService();

    await service.importCsv([HEADER, row({ landUseCode: 'ONT', expiryDate: '' })].join('\n'));

    expect(created()[0]).toMatchObject({
      tenureType: 'PERPETUAL',
      validityPeriod: '0',
      ownerCommitment: null, // not issued yet (D14)
    });
  });

  it('converts a limited-term expiry date into Unix seconds', async () => {
    const { service, created } = makeService();

    await service.importCsv(
      [HEADER, row({ landUseCode: 'LUC', expiryDate: FIFTY_YEARS_LATER })].join('\n'),
    );

    const validityPeriod = created()[0].validityPeriod as string;
    expect(Number(validityPeriod)).toBeGreaterThan(2_800_000_000);
    expect(validityPeriod).toMatch(/^\d+$/);
  });

  it('rejects an expiry date on perpetual land — it would be silently meaningless', async () => {
    const { service } = makeService();

    const result = await service.importCsv(
      [HEADER, row({ landUseCode: 'ONT', expiryDate: '01/01/2060' })].join('\n'),
    );

    expect(result.imported).toBe(0);
    expect(result.errors[0]).toMatchObject({ row: 2, propertyId: '1' });
    expect(result.errors[0].message).toMatch(/perpetual tenure/);
  });

  it('requires an expiry date on limited-term land', async () => {
    const { service } = makeService();

    const result = await service.importCsv(
      [HEADER, row({ landUseCode: 'LUC', expiryDate: '' })].join('\n'),
    );

    expect(result.errors[0].message).toMatch(/expiryDate is required/);
  });

  it('reports bad rows by line number and still imports the good ones', async () => {
    const { service, created } = makeService();

    const result = await service.importCsv(
      [
        HEADER,
        row({ propertyId: '1' }),
        row({ propertyId: '2', landUseCode: 'ZZZ' }),
        row({ propertyId: '3', area: '-5' }),
        row({ propertyId: '4' }),
      ].join('\n'),
    );

    expect(result.imported).toBe(2);
    expect(result.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(result.errors[0].message).toMatch(/Unknown landUseCode/);
    expect(result.errors[1].message).toMatch(/area must be a positive number/);
    expect(created().map((d) => d.propertyId)).toEqual(['1', '4']);
  });

  it('catches a propertyId repeated inside the same file', async () => {
    const { service } = makeService();

    const result = await service.importCsv(
      [HEADER, row({ propertyId: '7' }), row({ propertyId: '7' })].join('\n'),
    );

    expect(result.imported).toBe(1);
    expect(result.errors[0].message).toMatch(/duplicate propertyId/);
  });

  it('defaults encumbranceStatus to FREE and rejects unknown values', async () => {
    const { service, created } = makeService();

    await service.importCsv([HEADER, row({ encumbranceStatus: '' })].join('\n'));
    expect(created()[0]).toMatchObject({ encumbranceStatus: 'FREE' });

    const bad = await service.importCsv([HEADER, row({ encumbranceStatus: 'SOLD' })].join('\n'));
    expect(bad.errors[0].message).toMatch(/encumbranceStatus must be one of/);
  });

  it('stores area as a fixed-precision decimal', async () => {
    const { service, created } = makeService();

    await service.importCsv([HEADER, row({ area: '1,234.567' })].join('\n'));

    const area = created()[0].area as Prisma.Decimal;
    expect(area.toString()).toBe('1234.57');
  });

  it('parses DD/MM/YYYY, the format on Vietnamese certificates', () => {
    expect(parseVietnameseDate('15/01/2026').toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(() => parseVietnameseDate('2026-01-15')).toThrow(/DD\/MM\/YYYY/);
    // 31 February would otherwise roll over into March and import silently.
    expect(() => parseVietnameseDate('31/02/2026')).toThrow(/not a valid calendar date/);
  });

  describe('tenure supplied by the import, validated against the law (revised D2)', () => {
    it('accepts a lawful non-default tenure', async () => {
      const { service, created } = makeService();

      // Điều 171 khoản 4 — commercial land recognised for an individual.
      await service.importCsv(
        [HEADER, row({ landUseCode: 'TMD', tenureType: 'PERPETUAL', expiryDate: '' })].join('\n'),
      );

      expect(created()[0]).toMatchObject({ tenureType: 'PERPETUAL', validityPeriod: '0' });
    });

    it('rejects a tenure the code cannot lawfully have', async () => {
      const { service } = makeService();

      const result = await service.importCsv(
        [HEADER, row({ landUseCode: 'ONT', tenureType: 'PROJECT_LEASEHOLD' })].join('\n'),
      );

      expect(result.errors[0].message).toMatch(/not lawful for landUseCode 'ONT'/);
    });

    it('unlocks perpetual forest only for a management body (Điều 171 khoản 3)', async () => {
      const { service, created } = makeService();

      await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'RSX', tenureType: 'PERPETUAL', landUserType: 'TCN', expiryDate: '' }),
        ].join('\n'),
      );
      expect(created()[0]).toMatchObject({ tenureType: 'PERPETUAL', landUserType: 'TCN' });

      // An economic organisation producing on forest land holds a ≤50-year
      // grant (Điều 172 khoản 1 điểm b), not land it "manages".
      const economic = await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'RSX', tenureType: 'PERPETUAL', landUserType: 'TKT', expiryDate: '' }),
        ].join('\n'),
      );
      expect(economic.errors[0].message).toMatch(/not lawful/);

      const individual = await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'RSX', tenureType: 'PERPETUAL', landUserType: 'CNV', expiryDate: '' }),
        ].join('\n'),
      );
      expect(individual.errors[0].message).toMatch(/not lawful/);
    });

    it('makes community land perpetual only for cultural preservation (Điều 178 khoản 4)', async () => {
      const { service, created } = makeService();

      await service.importCsv(
        [
          HEADER,
          row({
            landUseCode: 'CLN',
            tenureType: 'PERPETUAL',
            landUserType: 'CDS',
            culturalPreservation: 'true',
            expiryDate: '',
          }),
        ].join('\n'),
      );
      expect(created()[0]).toMatchObject({ tenureType: 'PERPETUAL', culturalPreservation: true });

      // Community tenure on its own is an ordinary agricultural term.
      const withoutPurpose = await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'CLN', tenureType: 'PERPETUAL', landUserType: 'CDS', expiryDate: '' }),
        ].join('\n'),
      );
      expect(withoutPurpose.errors[0].message).toMatch(/not lawful/);
    });

    it('does not force the 50-year term on codes Điều 172 khoản 1 điểm a omits', async () => {
      const { service, created } = makeService();

      // CNT is new in Luật 2024 Điều 9 and điểm a does not list it, so a term
      // that is not exactly 50 years must be accepted.
      await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'CNT', issueDate: '15/01/2016', expiryDate: '15/01/2046' }),
        ].join('\n'),
      );
      expect(created()).toHaveLength(1);

      // …while a code that IS listed still has to be exactly 50.
      const listed = await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'CLN', issueDate: '15/01/2016', expiryDate: '15/01/2046' }),
        ].join('\n'),
      );
      expect(listed.errors[0].message).toMatch(/Điều 172 khoản 1 điểm a/);
    });

    it('rejects an unknown landUserType', async () => {
      const { service } = makeService();

      const result = await service.importCsv([HEADER, row({ landUserType: 'XXX' })].join('\n'));

      expect(result.errors[0].message).toMatch(/Unknown landUserType/);
    });
  });

  describe('statutory term (VAL-01, VAL-02)', () => {
    it("holds an individual's agricultural term to exactly 50 years", async () => {
      const { service, created } = makeService();

      await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'LUC', issueDate: '15/01/2016', expiryDate: FIFTY_YEARS_LATER }),
        ].join('\n'),
      );
      expect(created()).toHaveLength(1);

      // The defect the audit found in the old fixture: ~28 years on land the
      // law grants for 50.
      const short = await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'LUC', issueDate: '05/08/2019', expiryDate: '29/07/2047' }),
        ].join('\n'),
      );
      expect(short.errors[0].message).toMatch(/Điều 172 khoản 1 điểm a/);
    });

    it('caps a project lease at 50 years, or 70 with the long-term flag', async () => {
      const { service, created } = makeService();

      const tooLong = await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'SKK', issueDate: '15/01/2016', expiryDate: '15/01/2081' }),
        ].join('\n'),
      );
      expect(tooLong.errors[0].message).toMatch(/exceeds the 50-year cap/);

      await service.importCsv(
        [
          HEADER,
          row({
            landUseCode: 'SKK',
            issueDate: '15/01/2016',
            expiryDate: '15/01/2081',
            isLongTermInvestmentProject: 'true',
          }),
        ].join('\n'),
      );
      expect(created()).toHaveLength(1);
    });

    it('rejects an expiry that precedes the issue date', async () => {
      const { service } = makeService();

      const result = await service.importCsv(
        [
          HEADER,
          row({ landUseCode: 'LUC', issueDate: '15/01/2016', expiryDate: '15/01/2010' }),
        ].join('\n'),
      );

      expect(result.errors[0].message).toMatch(/must be after issueDate/);
    });
  });

  describe('administrative units and issuing authority (VAL-03..VAL-06)', () => {
    it('rejects an address carrying a district tier between commune and province', async () => {
      const { service } = makeService();

      // The abolished tier is caught structurally: since 01/7/2025 the commune
      // is followed directly by the province, so anything in between is a tier
      // that no longer exists — no keyword blacklist needed.
      for (const address of [
        'Số 3, Đường Lê Lợi, Phường Sài Gòn, Quận 1, TP.HCM',
        'Số 3, Đường X, Xã Bình Mỹ, Huyện Củ Chi, TP.HCM',
        'Số 3, Đường X, Phường Tân Định, Thành phố Thủ Đức, TP.HCM',
      ]) {
        const result = await service.importCsv([HEADER, row({ address })].join('\n'));
        expect(result.errors[0].message).toMatch(/district tier was abolished/);
      }
    });

    it('rejects an address with no commune-level segment at all', async () => {
      const { service } = makeService();

      const result = await service.importCsv(
        [HEADER, row({ address: 'Số 3, Đường Lê Lợi, TP.HCM' })].join('\n'),
      );

      expect(result.errors[0].message).toMatch(/must contain a commune-level unit/);
    });

    it('rejects a commune that is not in the seeded catalog', async () => {
      const { service } = makeService();

      // Đa Kao was dissolved in the 2025 merger, so it is absent from the catalog.
      const result = await service.importCsv(
        [HEADER, row({ address: 'Số 3, Đường Lê Lợi, Phường Đa Kao, TP.HCM' })].join('\n'),
      );

      expect(result.imported).toBe(0);
      expect(result.errors[0].message).toMatch(/not in the administrative catalog/);
    });

    it('imports with a warning when the catalog has not been seeded yet', async () => {
      const { service } = makeService({ catalog: [] });

      // Without a catalog the check cannot run. Blocking every import until the
      // official list is loaded would be worse than saying so plainly.
      const result = await service.importCsv(
        [HEADER, row({ address: 'Số 3, Đường Lê Lợi, Phường Đa Kao, TP.HCM' })].join('\n'),
      );

      expect(result.imported).toBe(1);
      expect(result.warnings[0].message).toMatch(/catalog\s+is empty/);
    });

    it('rejects an agency that is not competent under the current law', async () => {
      const { service } = makeService();

      // Merged into "Sở Nông nghiệp và Môi trường" on 01/5/2025 — rejected as
      // simply not on the whitelist, with no old-name lookup table.
      const result = await service.importCsv(
        [HEADER, row({ issuingAuthority: 'Sở Tài nguyên và Môi trường TP.HCM' })].join('\n'),
      );

      expect(result.errors[0].message).toMatch(/not a body competent to issue a certificate/);
    });

    it('accepts the commune chairperson, competent since 01/7/2025', async () => {
      const { service, created } = makeService();

      await service.importCsv(
        [HEADER, row({ issuingAuthority: 'Chủ tịch UBND phường Sài Gòn' })].join('\n'),
      );

      expect(created()).toHaveLength(1);
    });

    it('rejects a malformed certificateSerial', async () => {
      const { service } = makeService();

      const result = await service.importCsv([HEADER, row({ certificateSerial: 'X1' })].join('\n'));

      expect(result.errors[0].message).toMatch(/2 letters followed by 6 digits/);
    });

    it('rejects an empty bookEntryNumber', async () => {
      const { service } = makeService();

      const result = await service.importCsv([HEADER, row({ bookEntryNumber: '' })].join('\n'));

      expect(result.errors[0].message).toMatch(/missing required column 'bookEntryNumber'/);
    });
  });

  describe('only codes from the current table are accepted (A17)', () => {
    it.each(['BHK', 'NHK', 'NTS_CD', 'DDT'])('rejects the retired code %s', async (code) => {
      const { service } = makeService();

      const result = await service.importCsv(
        [HEADER, row({ landUseCode: code, expiryDate: FIFTY_YEARS_LATER })].join('\n'),
      );

      expect(result.imported).toBe(0);
      expect(result.errors[0].message).toMatch(/Unknown landUseCode/);
      // The error lists what IS accepted, so a stale export can be corrected
      // without a lookup table of superseded codes living in the source.
      expect(result.errors[0].message).toMatch(/HNK/);
    });
  });
});
