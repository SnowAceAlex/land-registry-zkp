import * as fs from 'fs';
import * as path from 'path';

import {
  CatalogUnit,
  EXPECTED_BRANCH_COUNT,
  EXPECTED_UNIT_COUNT,
  LandOfficeFile,
  parseLandOfficeFile,
  planUnitAssignment,
} from './land-office-catalog';

const committed = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', 'seed', 'land-offices.hcmc.json'), 'utf8'),
);

/** A structurally valid file with the expected counts; tests mutate a copy. */
function validFile(): LandOfficeFile {
  const branches = Array.from({ length: EXPECTED_BRANCH_COUNT }, (_, i) => ({
    code: `CN${String(i + 1).padStart(2, '0')}`,
    name: `Chi nhánh ${i + 1}`,
    units: [] as { type: 'PHUONG'; name: string }[],
  }));
  for (let u = 0; u < EXPECTED_UNIT_COUNT; u++) {
    branches[u % EXPECTED_BRANCH_COUNT].units.push({ type: 'PHUONG', name: `Unit ${u}` });
  }
  return {
    province: 'TP.HCM',
    central: [
      { code: 'HQ', name: 'HQ', kind: 'HEAD_OFFICE' },
      { code: 'CS2', name: 'CS2', kind: 'SITE' },
      { code: 'CS3', name: 'CS3', kind: 'SITE' },
    ],
    branches,
  };
}

describe('parseLandOfficeFile', () => {
  it('accepts the committed HCMC file (38 branches / 168 units)', () => {
    const file = parseLandOfficeFile(committed);
    expect(file.branches).toHaveLength(38);
    expect(file.branches.reduce((n, b) => n + b.units.length, 0)).toBe(168);
    expect(file.branches.find((b) => b.code === 'CN28').units).toContainEqual({
      type: 'PHUONG',
      name: 'Bình Cơ',
    });
  });

  it('accepts a valid fixture', () => {
    expect(() => parseLandOfficeFile(validFile())).not.toThrow();
  });

  it('rejects a wrong top-level shape', () => {
    expect(() => parseLandOfficeFile(null)).toThrow();
    expect(() => parseLandOfficeFile([])).toThrow();
    expect(() => parseLandOfficeFile({ province: 'x' })).toThrow();
  });

  it('rejects a wrong branch count', () => {
    const file = validFile();
    file.branches.pop();
    expect(() => parseLandOfficeFile(file)).toThrow(/branch/i);
  });

  it('rejects a wrong total unit count', () => {
    const file = validFile();
    file.branches[0].units.push({ type: 'XA', name: 'Extra' });
    expect(() => parseLandOfficeFile(file)).toThrow(/unit/i);
  });

  it('rejects a duplicate office code', () => {
    const file = validFile();
    file.branches[1].code = file.branches[0].code;
    expect(() => parseLandOfficeFile(file)).toThrow(/duplicate.*CN01/i);
  });

  it('rejects a code outside HQ|CS2|CS3|CNxx', () => {
    const file = validFile();
    file.branches[0].code = 'XX01';
    expect(() => parseLandOfficeFile(file)).toThrow(/XX01/);
  });

  it('rejects a duplicate unit name across branches, ignoring case and NFD', () => {
    const file = validFile();
    file.branches[0].units[0].name = 'Bình Cơ';
    file.branches[1].units[0].name = 'Bình Cơ'.toLowerCase();
    expect(() => parseLandOfficeFile(file)).toThrow(/duplicate unit/i);
  });

  it('rejects an empty unit list', () => {
    const file = validFile();
    const moved = file.branches[0].units.splice(0);
    file.branches[1].units.push(...moved);
    expect(() => parseLandOfficeFile(file)).toThrow(/CN01.*no units|empty/i);
  });

  it('lists every problem in one error', () => {
    const file = validFile();
    file.branches[0].code = 'XX01';
    file.branches.pop();
    let message = '';
    try {
      parseLandOfficeFile(file);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/XX01/);
    expect(message).toMatch(/branch/i);
  });
});

describe('planUnitAssignment', () => {
  const file: LandOfficeFile = {
    province: 'TP.HCM',
    central: [],
    branches: [
      { code: 'CN01', name: 'a', units: [{ type: 'PHUONG', name: 'Tân Định' }] },
      {
        code: 'CN02',
        name: 'b',
        units: [
          { type: 'XA', name: 'Bình Cơ' },
          { type: 'PHUONG', name: 'Ghost' },
        ],
      },
    ],
  };
  const catalog: CatalogUnit[] = [
    { id: 1, name: 'Tân Định', type: 'PHUONG' },
    { id: 2, name: 'Bình Cơ', type: 'PHUONG' },
    { id: 3, name: 'Orphan', type: 'XA' },
  ];

  it('assigns matched units and reports the three kinds of difference', () => {
    const plan = planUnitAssignment(file, catalog);
    expect(plan.assignments).toEqual([
      { unitId: 1, officeCode: 'CN01' },
      { unitId: 2, officeCode: 'CN02' },
    ]);
    expect(plan.missingInCatalog).toEqual(['Ghost']);
    expect(plan.unassignedInCatalog).toEqual(['Orphan']);
    expect(plan.typeMismatches).toEqual(['Bình Cơ: file XA, catalog PHUONG']);
  });

  it('matches NFD input against NFC catalog names', () => {
    const nfd: LandOfficeFile = {
      ...file,
      branches: [
        {
          code: 'CN01',
          name: 'a',
          units: [{ type: 'PHUONG', name: 'Tân Định' }],
        },
      ],
    };
    const plan = planUnitAssignment(nfd, [{ id: 1, name: 'Tân Định', type: 'PHUONG' }]);
    expect(plan.assignments).toEqual([{ unitId: 1, officeCode: 'CN01' }]);
    expect(plan.missingInCatalog).toEqual([]);
  });
});
