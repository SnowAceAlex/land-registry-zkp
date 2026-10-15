import { Prisma } from '@prisma/client';
import { MAX_PROPERTY_ID } from '@land-registry/blockchain/shared';

import { ImportService, parseVietnameseDate } from './import.service';
import { AdministrativeUnitsService } from '../land-law/administrative-units.service';
import { LineageService } from '../lineage/lineage.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The DB is stubbed: these tests are about row validation and the derivations
 * that end up inside an immutable leaf hash, not about Prisma.
 */
/** Commune-level units the address tests resolve against, standing in for the seeded catalog. */
const CATALOG = ['Sài Gòn', 'Tân Định', 'Bình Mỹ'];

type Office = { id: number; code: string };

function makeService({
  catalog = CATALOG,
  existing = [],
  offices = {},
  statuses = {},
  edges = [],
}: {
  catalog?: string[];
  existing?: string[];
  /** commune name → office the catalog assigns it to */
  offices?: Record<string, Office>;
  /** propertyId → status of rows already in the registry (default ISSUED) */
  statuses?: Record<string, string>;
  /** supersession edges already recorded */
  edges?: { predecessorPropertyId: string; successorPropertyId: string }[];
} = {}) {
  // Rows that exist in the registry: the `existing` ids plus anything given a status.
  const registered = [...new Set([...existing, ...Object.keys(statuses)])];
  const createMany = jest.fn((args: { data: Prisma.PropertyCreateManyInput[] }) =>
    Promise.resolve({
      // Mirrors skipDuplicates: rows whose propertyId is already registered are not written.
      count: args.data.filter((input) => !registered.includes(input.propertyId)).length,
    }),
  );
  const findMany = jest.fn(async () =>
    catalog.map((name) => ({ name, landOffice: offices[name] ?? null })),
  );
  const propertyFindMany = jest.fn(async ({ where }: { where: { propertyId: { in: string[] } } }) =>
    registered
      .filter((propertyId) => where.propertyId.in.includes(propertyId))
      .map((propertyId) => ({ propertyId, status: statuses[propertyId] ?? 'ISSUED' })),
  );
  const lineageFindMany = jest.fn(
    async ({ where }: { where: { predecessorPropertyId: { in: string[] } } }) =>
      edges.filter((edge) => where.predecessorPropertyId.in.includes(edge.predecessorPropertyId)),
  );
  const lineageCreateMany = jest.fn((args: unknown) => Promise.resolve({ args }));
  const $transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));
  const prisma = {
    property: { createMany, findMany: propertyFindMany },
    administrativeUnit: { findMany },
    propertyLineage: { findMany: lineageFindMany, createMany: lineageCreateMany },
    $transaction,
  } as unknown as PrismaService;

  // Reads the MOST RECENT call: several tests import a rejected file first and
  // a valid one second, and pinning to call 0 would assert against the reject.
  const created = () => createMany.mock.calls[createMany.mock.calls.length - 1][0].data;
  const service = new ImportService(
    prisma,
    new AdministrativeUnitsService(prisma),
    new LineageService(prisma),
  );
  return { service, createMany, created, lineageCreateMany, $transaction, propertyFindMany };
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
  'supersedesPropertyIds',
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
    supersedesPropertyIds: '',
    ...overrides,
  };
  // Quoted because a comma inside an address or a thousands separator would
  // otherwise split the column — which is how a real spreadsheet export writes it.
  return COLUMNS.map((column) => `"${values[column]}"`).join(',');
}

describe('ImportService', () => {
  describe('dry run before writing (D52)', () => {
    const twoRows = [
      HEADER,
      row({ propertyId: '1', certificateSerial: 'CT 100001' }),
      row({ propertyId: '2', certificateSerial: 'CT 100002' }),
      row({ propertyId: '3', landUseCode: 'ZZZ', certificateSerial: 'CT 100003' }),
    ].join('\n');

    it('validates every row but writes nothing', async () => {
      const { service, createMany } = makeService();

      const result = await service.importCsv(twoRows, { dryRun: true });

      expect(createMany).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].propertyId).toBe('3');
    });

    it('counts valid rows already in the registry as skipped, as the real import would', async () => {
      const { service } = makeService({ existing: ['2'] });

      const preview = await service.importCsv(twoRows, { dryRun: true });
      const written = await service.importCsv(twoRows);

      expect(preview).toMatchObject({ imported: 1, skipped: 1 });
      // The preview is only useful if it predicts the commit exactly.
      expect(written).toMatchObject({ dryRun: false, imported: 1, skipped: 1 });
    });
  });

  describe('land office derived from the commune (D85)', () => {
    const HQ_OFFICE = { id: 1, code: 'HQ' };
    const CN01 = { id: 4, code: 'CN01' };
    const TAN_DINH = 'Số 3, Đường X, Phường Tân Định, TP.HCM';

    it('stamps each written row with the office its commune belongs to', async () => {
      const { service, created } = makeService({
        offices: { 'Sài Gòn': CN01, 'Tân Định': HQ_OFFICE },
      });

      await service.importCsv(
        [
          HEADER,
          row({ propertyId: '1' }),
          row({ propertyId: '2', certificateSerial: 'CT 100002', address: TAN_DINH }),
        ].join('\n'),
      );

      expect(created().map((d) => d.landOfficeId)).toEqual([4, 1]);
    });

    it('leaves landOfficeId null when the unit is unassigned or the catalog is empty', async () => {
      const unassigned = makeService();
      await unassigned.service.importCsv([HEADER, row()].join('\n'));
      expect(unassigned.created()[0].landOfficeId).toBeNull();

      const empty = makeService({ catalog: [] });
      await empty.service.importCsv([HEADER, row()].join('\n'));
      expect(empty.created()[0].landOfficeId).toBeNull();
    });

    it('counts written rows per office, null last', async () => {
      const { service } = makeService({ offices: { 'Sài Gòn': CN01, 'Tân Định': HQ_OFFICE } });

      const result = await service.importCsv(
        [
          HEADER,
          row({ propertyId: '1' }),
          row({ propertyId: '2', certificateSerial: 'CT 100002', address: TAN_DINH }),
          row({ propertyId: '3', certificateSerial: 'CT 100003' }),
          row({ propertyId: '4', certificateSerial: 'CT 100004', landUseCode: 'ZZZ' }),
          row({
            propertyId: '5',
            certificateSerial: 'CT 100005',
            address: 'Số 3, Đường X, Xã Bình Mỹ, TP.HCM',
          }),
        ].join('\n'),
        { dryRun: true },
      );

      expect(result.byOffice).toEqual([
        { officeCode: 'CN01', count: 2 },
        { officeCode: 'HQ', count: 1 },
        { officeCode: null, count: 1 },
      ]);
    });

    it('leaves rows already in the registry out of byOffice', async () => {
      const { service } = makeService({ existing: ['1'], offices: { 'Sài Gòn': CN01 } });

      const result = await service.importCsv(
        [
          HEADER,
          row({ propertyId: '1' }),
          row({ propertyId: '2', certificateSerial: 'CT 100002' }),
        ].join('\n'),
        { dryRun: true },
      );

      expect(result.byOffice).toEqual([{ officeCode: 'CN01', count: 1 }]);
    });
  });

  describe('certificate supersession (D83, D90)', () => {
    const successor = (supersedesPropertyIds: string, propertyId = '10') =>
      [HEADER, row({ propertyId, supersedesPropertyIds })].join('\n');

    it.each([
      ['a non-numeric id', 'abc'],
      ['a negative id', '-3'],
      ['an id beyond the tree', (MAX_PROPERTY_ID + 1n).toString()],
      ['a decimal', '1.5'],
    ])('rejects %s as InvalidSupersedes', async (_label, value) => {
      const { service, createMany } = makeService({ existing: ['1'] });

      const result = await service.importCsv(successor(`1;${value}`));

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        row: 2,
        propertyId: '10',
        code: 'InvalidSupersedes',
      });
      expect(createMany.mock.calls[0][0].data).toEqual([]);
    });

    it('rejects a row that supersedes itself', async () => {
      const { service } = makeService({ existing: ['10'] });

      const result = await service.importCsv(successor('10'));

      expect(result.errors[0]).toMatchObject({ code: 'SelfSupersession', propertyId: '10' });
      expect(result.imported).toBe(0);
    });

    it('rejects a predecessor that is not in the registry', async () => {
      const { service } = makeService({ existing: ['1'] });

      const result = await service.importCsv(successor('1;2'));

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ row: 2, code: 'PredecessorNotFound' });
      expect(result.errors[0].message).toContain('2');
      expect(result.imported).toBe(0);
    });

    it('rejects a predecessor that was never issued', async () => {
      const { service } = makeService({ statuses: { '1': 'IMPORTED' } });

      const result = await service.importCsv(successor('1'));

      expect(result.errors[0]).toMatchObject({ code: 'PredecessorNeverIssued' });
      expect(result.imported).toBe(0);
    });

    it('accepts a revoked predecessor — superseding it is the normal path', async () => {
      const { service } = makeService({ statuses: { '1': 'REVOKED' } });

      const result = await service.importCsv(successor('1'));

      expect(result.errors).toEqual([]);
      expect(result.imported).toBe(1);
    });

    it('warns, but still imports, when the predecessor already has a successor (a split)', async () => {
      const { service } = makeService({
        existing: ['1'],
        edges: [{ predecessorPropertyId: '1', successorPropertyId: '9' }],
      });

      const result = await service.importCsv(successor('1'), { dryRun: true });

      expect(result.errors).toEqual([]);
      expect(result.imported).toBe(1);
      expect(result.warnings).toEqual([
        expect.objectContaining({ row: 2, propertyId: '10', code: 'PredecessorAlreadySucceeded' }),
      ]);
    });

    it('does not warn about the edge this same row already recorded', async () => {
      const { service } = makeService({
        existing: ['1', '10'],
        edges: [{ predecessorPropertyId: '1', successorPropertyId: '10' }],
      });

      const result = await service.importCsv(successor('1'), { dryRun: true });

      expect(result.warnings).toEqual([]);
    });

    it('keeps the line number and imports the other rows when one row fails', async () => {
      const { service, created } = makeService({ existing: ['1'] });

      const result = await service.importCsv(
        [
          HEADER,
          row({ propertyId: '10', supersedesPropertyIds: '1' }),
          row({ propertyId: '11', certificateSerial: 'CT 100011', supersedesPropertyIds: '77' }),
          row({ propertyId: '12', certificateSerial: 'CT 100012' }),
        ].join('\n'),
      );

      expect(result.errors).toEqual([
        expect.objectContaining({ row: 3, propertyId: '11', code: 'PredecessorNotFound' }),
      ]);
      expect(created().map((d) => d.propertyId)).toEqual(['10', '12']);
    });

    it('ignores empty parts and whitespace in the list', async () => {
      const { service, lineageCreateMany } = makeService({ existing: ['1', '2'] });

      const result = await service.importCsv(successor(' 1 ; ;2;'));

      expect(result.errors).toEqual([]);
      expect(lineageCreateMany.mock.calls[0][0]).toMatchObject({
        data: [
          { predecessorPropertyId: '1', successorPropertyId: '10' },
          { predecessorPropertyId: '2', successorPropertyId: '10' },
        ],
      });
    });

    it('writes nothing on a dry run, not even lineage', async () => {
      const { service, createMany, lineageCreateMany, $transaction } = makeService({
        existing: ['1'],
      });

      const result = await service.importCsv(successor('1'), { dryRun: true });

      expect(result.imported).toBe(1);
      expect(createMany).not.toHaveBeenCalled();
      expect(lineageCreateMany).not.toHaveBeenCalled();
      expect($transaction).not.toHaveBeenCalled();
    });

    it('commits the plots and their edges in one transaction', async () => {
      const { service, createMany, lineageCreateMany, $transaction } = makeService({
        existing: ['1', '2'],
      });

      const result = await service.importCsv(successor('1;2'));

      expect(result).toMatchObject({ imported: 1, skipped: 0, errors: [] });
      expect($transaction).toHaveBeenCalledTimes(1);
      expect($transaction.mock.calls[0][0]).toHaveLength(2);
      expect(createMany).toHaveBeenCalledTimes(1);
      expect(lineageCreateMany).toHaveBeenCalledWith({
        data: [
          { predecessorPropertyId: '1', successorPropertyId: '10' },
          { predecessorPropertyId: '2', successorPropertyId: '10' },
        ],
        skipDuplicates: true,
      });
    });

    it('records no edge for a row that already exists in the registry', async () => {
      const { service, lineageCreateMany, created } = makeService({ existing: ['1', '10'] });

      const result = await service.importCsv(successor('1'));

      expect(result).toMatchObject({ imported: 0, skipped: 1 });
      expect(created()).toEqual([]);
      expect(lineageCreateMany).toHaveBeenCalledWith({ data: [], skipDuplicates: true });
    });
  });

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

  it('rejects a propertyId beyond the addressable range of the tree (D41)', async () => {
    const { service } = makeService();

    const result = await service.importCsv(
      // MAX_PROPERTY_ID + 1, derived — a literal here silently stops testing
      // anything the moment TREE_DEPTH moves (it did, at D71).
      [
        HEADER,
        row({ propertyId: '1' }),
        row({ propertyId: (MAX_PROPERTY_ID + 1n).toString() }),
      ].join('\n'),
    );

    expect(result.imported).toBe(1);
    expect(result.errors[0].message).toMatch(/exceeds the addressable range/);
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

    it('imports and flags an unseeded catalog once, not as a warning on every row (D52)', async () => {
      const { service } = makeService({ catalog: [] });

      // Without a catalog the check cannot run. Blocking every import until the
      // official list is loaded would be worse than saying so plainly — but
      // saying it once per row buries every real warning under identical noise.
      const result = await service.importCsv(
        [
          HEADER,
          row({ address: 'Số 3, Đường Lê Lợi, Phường Đa Kao, TP.HCM' }),
          row({
            propertyId: '2',
            certificateSerial: 'CT 100002',
            address: 'Số 5, Đường Lê Lợi, Phường Đa Kao, TP.HCM',
          }),
        ].join('\n'),
      );

      expect(result.imported).toBe(2);
      expect(result.catalogEmpty).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('reports catalogEmpty: false once the catalog is seeded', async () => {
      const { service } = makeService();

      const result = await service.importCsv([HEADER, row()].join('\n'));

      expect(result.catalogEmpty).toBe(false);
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
