import { normaliseUnitName } from '../land-law/administrative-units.service';

export const EXPECTED_BRANCH_COUNT = 38;
export const EXPECTED_UNIT_COUNT = 168;

type UnitType = 'PHUONG' | 'XA' | 'DAC_KHU';

export interface LandOfficeFile {
  province: string;
  central: { code: string; name: string; kind: 'HEAD_OFFICE' | 'SITE' }[];
  branches: { code: string; name: string; units: { type: UnitType; name: string }[] }[];
}

const CODE_PATTERN = /^(HQ|CS[23]|CN\d{2})$/;
const UNIT_TYPES: readonly string[] = ['PHUONG', 'XA', 'DAC_KHU'];
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** @throws one Error listing every problem found. */
export function parseLandOfficeFile(raw: unknown): LandOfficeFile {
  if (!isRecord(raw) || !isText(raw.province) || !Array.isArray(raw.central)) {
    throw new Error('land office file: expected { province, central[], branches[] }');
  }
  if (!Array.isArray(raw.branches)) {
    throw new Error('land office file: expected { province, central[], branches[] }');
  }

  const problems: string[] = [];
  const codes = new Set<string>();
  const checkCode = (code: unknown, where: string) => {
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
      problems.push(`${where}: invalid office code '${String(code)}'`);
    } else if (codes.has(code)) {
      problems.push(`duplicate office code ${code}`);
    } else {
      codes.add(code);
    }
  };

  for (const [i, office] of (raw.central as unknown[]).entries()) {
    const o = isRecord(office) ? office : {};
    checkCode(o.code, `central[${i}]`);
    if (!isText(o.name)) problems.push(`central[${i}]: name is required`);
    if (o.kind !== 'HEAD_OFFICE' && o.kind !== 'SITE') {
      problems.push(`central[${i}]: kind must be HEAD_OFFICE or SITE`);
    }
  }

  if (raw.branches.length !== EXPECTED_BRANCH_COUNT) {
    problems.push(`expected ${EXPECTED_BRANCH_COUNT} branches, found ${raw.branches.length}`);
  }

  const seenUnits = new Map<string, string>();
  let unitTotal = 0;
  for (const [i, branch] of (raw.branches as unknown[]).entries()) {
    const b = isRecord(branch) ? branch : {};
    const label = typeof b.code === 'string' ? b.code : `branches[${i}]`;
    checkCode(b.code, `branches[${i}]`);
    if (!isText(b.name)) problems.push(`${label}: name is required`);
    const units = Array.isArray(b.units) ? b.units : [];
    if (units.length === 0) problems.push(`${label}: empty unit list`);
    for (const unit of units) {
      const u = isRecord(unit) ? unit : {};
      if (!isText(u.name) || !UNIT_TYPES.includes(u.type as string)) {
        problems.push(`${label}: malformed unit ${JSON.stringify(unit)}`);
        continue;
      }
      unitTotal++;
      const key = normaliseUnitName(u.name);
      const first = seenUnits.get(key);
      if (first) problems.push(`duplicate unit '${u.name}' in ${first} and ${label}`);
      else seenUnits.set(key, label);
    }
  }
  if (unitTotal !== EXPECTED_UNIT_COUNT) {
    problems.push(`expected ${EXPECTED_UNIT_COUNT} units in total, found ${unitTotal}`);
  }

  if (problems.length > 0) {
    throw new Error(`land office file is invalid:\n  ${problems.join('\n  ')}`);
  }
  return raw as unknown as LandOfficeFile;
}

export interface CatalogUnit {
  id: number;
  name: string;
  type: UnitType;
}

export interface UnitAssignmentPlan {
  assignments: { unitId: number; officeCode: string }[];
  /** File names with no catalog row. */
  missingInCatalog: string[];
  /** Catalog rows of this province that no branch claims. */
  unassignedInCatalog: string[];
  /** Warning only: the file and the catalog disagree on the unit type. */
  typeMismatches: string[];
}

export function planUnitAssignment(
  file: LandOfficeFile,
  catalog: CatalogUnit[],
): UnitAssignmentPlan {
  const byName = new Map(catalog.map((unit) => [normaliseUnitName(unit.name), unit]));
  const claimed = new Set<number>();
  const plan: UnitAssignmentPlan = {
    assignments: [],
    missingInCatalog: [],
    unassignedInCatalog: [],
    typeMismatches: [],
  };

  for (const branch of file.branches) {
    for (const unit of branch.units) {
      const match = byName.get(normaliseUnitName(unit.name));
      if (!match) {
        plan.missingInCatalog.push(unit.name);
        continue;
      }
      claimed.add(match.id);
      plan.assignments.push({ unitId: match.id, officeCode: branch.code });
      if (match.type !== unit.type) {
        plan.typeMismatches.push(`${unit.name}: file ${unit.type}, catalog ${match.type}`);
      }
    }
  }
  plan.unassignedInCatalog = catalog.filter((u) => !claimed.has(u.id)).map((u) => u.name);
  return plan;
}
