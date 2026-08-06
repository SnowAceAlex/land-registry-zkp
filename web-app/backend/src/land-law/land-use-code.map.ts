import { BadRequestException } from '@nestjs/common';
import { TenureType, UseType } from '@land-registry/blockchain/shared';

/**
 * Vietnamese land use codes (mã đất) per Phụ lục II Thông tư 08/2024/TT-BTNMT (Luật Đất đai 2024)
 * - Tenure depends on how the land was granted (giao/cho thuê/công nhận) and the user type (Điều 171)
 * - Old codes (TT 27/2018, TT 25/2014) are no longer supported
 */

/** Land user types (Đối tượng sử dụng đất, mục B Phụ lục II TT 08/2024) - off-chain, used to validate tenure */
export enum LandUserType {
  /** Cá nhân trong nước */
  CNV = 'CNV',
  /** Cộng đồng dân cư */
  CDS = 'CDS',
  /** Tổ chức kinh tế */
  TKT = 'TKT',
  /** Cơ quan nhà nước, cơ quan Đảng, đơn vị vũ trang nhân dân (mục 2.1) */
  TCN = 'TCN',
  /** Tổ chức sự nghiệp công lập */
  TSN = 'TSN',
}

export const LAND_USER_TYPE_LABEL: Record<LandUserType, string> = {
  [LandUserType.CNV]: 'Cá nhân trong nước',
  [LandUserType.CDS]: 'Cộng đồng dân cư',
  [LandUserType.TKT]: 'Tổ chức kinh tế',
  [LandUserType.TCN]: 'Cơ quan nhà nước, cơ quan Đảng, đơn vị vũ trang nhân dân',
  [LandUserType.TSN]: 'Tổ chức sự nghiệp công lập',
};

/** Organisations (non-individuals) per Điều 171 */
const ORGANISATION_USER_TYPES: readonly LandUserType[] = [
  LandUserType.TKT,
  LandUserType.TCN,
  LandUserType.TSN,
];

/**
 * Bodies that can be assigned forest management, for whom production-forest
 * land is perpetual (Điều 171 khoản 3, "do tổ chức quản lý").
 *
 * `TKT` is deliberately absent: an economic organisation allocated or leased
 * forest land to produce on it falls under Điều 172 khoản 1 điểm b (≤50 years),
 * not under "quản lý". Reading "tổ chức" as "any organisation" would let a
 * 50-year lease be recorded as perpetual — and the tenure goes into an
 * immutable leaf, so the conservative reading is the correct default.
 */
const FOREST_MANAGEMENT_USER_TYPES: readonly LandUserType[] = [LandUserType.TCN, LandUserType.TSN];

/**
 * Facts about the grant that decide which tenures are lawful. Kept separate
 * from the land code because the law keys off the grant, not the category.
 */
export interface TenureContext {
  landUserType?: LandUserType;
  /**
   * Đất cộng đồng dân cư được giao/công nhận **để bảo tồn bản sắc dân tộc gắn
   * với phong tục, tập quán, tín ngưỡng** (Điều 178 khoản 4). Only that purpose
   * makes community land perpetual — community use alone does not.
   */
  culturalPreservation?: boolean;
}

export interface LandUseCodeClassification {
  useType: UseType;
  /** Tenures lawful for this code; the import must pick one of them. */
  tenures: readonly TenureType[];
  /** Used when the import omits the column — the ordinary case for the code. */
  defaultTenure: TenureType;
  /** Vietnamese label, shown in the UI and on the issued PDF */
  label: string;
  /**
   * Extra tenures unlocked by the circumstances of the grant (Điều 171 khoản
   * 2/3/4). Returns nothing when the condition is unmet, so the default stays
   * the conservative one.
   */
  conditionalTenures?: (context: TenureContext) => readonly TenureType[];
}

const { PERPETUAL, FIXED_TERM, PROJECT_LEASEHOLD } = TenureType;

/**
 * Điều 171 khoản 2 → Điều 178 khoản 4. Both conditions are required: held by a
 * residential community AND used for cultural preservation. Community tenure on
 * its own is an ordinary agricultural term.
 */
const communityCulturalPerpetual = (context: TenureContext): readonly TenureType[] =>
  context.landUserType === LandUserType.CDS && context.culturalPreservation ? [PERPETUAL] : [];

/** Điều 171 khoản 3 — production forest land held by a body assigned to manage it. */
const forestManagementPerpetual = (context: TenureContext): readonly TenureType[] =>
  context.landUserType && FOREST_MANAGEMENT_USER_TYPES.includes(context.landUserType)
    ? [PERPETUAL]
    : [];

/**
 * Codes whose term Điều 172 khoản 1 điểm a fixes at 50 years for an individual,
 * and which continue in use afterwards without any renewal procedure: annual
 * crops (including rice), perennial crops, aquaculture, salt, and production
 * forest **that is planted forest**.
 *
 * `CNT` (đất chăn nuôi tập trung) is absent on purpose — it is a category Luật
 * 2024 created in Điều 9 and điểm a does not list it. `RSN` (natural production
 * forest) is absent because điểm a says "rừng sản xuất là rừng trồng".
 */
export const STATUTORY_FIFTY_YEAR_CODES: readonly string[] = [
  'LUC',
  'LUK',
  'CLN',
  'HNK',
  'NTS',
  'LMU',
  'RSX',
];

/** True when Điều 172 khoản 1 điểm a fixes this code's term at 50 years. */
export function hasStatutoryFiftyYearTerm(code: string): boolean {
  return STATUTORY_FIFTY_YEAR_CODES.includes(normalize(code));
}

export const LAND_USE_CODES: Record<string, LandUseCodeClassification> = {
  // Residential land (Đất ở) - PERPETUAL (sử dụng ổn định lâu dài - Điều 171 khoản 1)
  ONT: {
    useType: UseType.RESIDENTIAL,
    tenures: [PERPETUAL],
    defaultTenure: PERPETUAL,
    label: 'Đất ở tại nông thôn',
  },
  ODT: {
    useType: UseType.RESIDENTIAL,
    tenures: [PERPETUAL],
    defaultTenure: PERPETUAL,
    label: 'Đất ở tại đô thị',
  },

  // Agricultural land (Đất nông nghiệp) - 50 years for individuals (Điều 172 khoản 1 điểm a), PERPETUAL for communities (Điều 171 khoản 2)
  LUC: {
    useType: UseType.AGRICULTURAL,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất chuyên trồng lúa',
    conditionalTenures: communityCulturalPerpetual,
  },
  LUK: {
    useType: UseType.AGRICULTURAL,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất trồng lúa còn lại',
    conditionalTenures: communityCulturalPerpetual,
  },
  CLN: {
    useType: UseType.AGRICULTURAL,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất trồng cây lâu năm',
    conditionalTenures: communityCulturalPerpetual,
  },
  HNK: {
    useType: UseType.AGRICULTURAL,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất trồng cây hằng năm khác',
    conditionalTenures: communityCulturalPerpetual,
  },
  CNT: {
    useType: UseType.AGRICULTURAL,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất chăn nuôi tập trung',
  },
  NTS: {
    useType: UseType.AGRICULTURAL,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất nuôi trồng thủy sản',
    conditionalTenures: communityCulturalPerpetual,
  },
  LMU: {
    useType: UseType.AGRICULTURAL,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất làm muối',
  },

  // Forestry land (Đất lâm nghiệp) - PERPETUAL if managed by an organisation (Điều 171 khoản 3)
  RSX: {
    useType: UseType.FORESTRY,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất rừng sản xuất là rừng trồng',
    conditionalTenures: forestManagementPerpetual,
  },
  RSN: {
    useType: UseType.FORESTRY,
    tenures: [FIXED_TERM],
    defaultTenure: FIXED_TERM,
    label: 'Đất rừng sản xuất là rừng tự nhiên',
    conditionalTenures: forestManagementPerpetual,
  },

  // Non-agricultural land (Đất phi nông nghiệp) - limited term if leased for a project, PERPETUAL if stable use by an individual (Điều 171 khoản 4)
  TMD: {
    useType: UseType.COMMERCIAL,
    tenures: [PROJECT_LEASEHOLD, PERPETUAL],
    defaultTenure: PROJECT_LEASEHOLD,
    label: 'Đất thương mại, dịch vụ',
  },
  SKC: {
    useType: UseType.INDUSTRIAL,
    tenures: [PROJECT_LEASEHOLD, PERPETUAL],
    defaultTenure: PROJECT_LEASEHOLD,
    label: 'Đất cơ sở sản xuất phi nông nghiệp',
  },
  SKK: {
    useType: UseType.INDUSTRIAL,
    tenures: [PROJECT_LEASEHOLD],
    defaultTenure: PROJECT_LEASEHOLD,
    label: 'Đất khu công nghiệp',
  },
};

export function isKnownLandUseCode(code: string): boolean {
  return Boolean(LAND_USE_CODES[normalize(code)]);
}

/** Return a list of all supported land use codes (mã đất) */
export function supportedLandUseCodes(): string[] {
  return Object.keys(LAND_USE_CODES);
}

/** Map a land use code to its details. Throws an error if the code is unknown or obsolete */
export function classifyLandUseCode(code: string): LandUseCodeClassification {
  const classification = LAND_USE_CODES[normalize(code)];
  if (!classification) {
    throw new BadRequestException(
      `Unknown landUseCode '${code}'. Supported codes (Phụ lục II TT 08/2024/TT-BTNMT): ` +
        supportedLandUseCodes().join(', '),
    );
  }
  return classification;
}

/** Tenures lawful for a code given the circumstances of the grant. */
export function allowedTenures(code: string, context: TenureContext = {}): readonly TenureType[] {
  const classification = classifyLandUseCode(code);
  const extra = classification.conditionalTenures?.(context) ?? [];
  return Array.from(new Set([...classification.tenures, ...extra]));
}

/** Resolve the final tenure type and check that it is lawful. */
export function resolveTenureType(
  code: string,
  explicit: TenureType | undefined,
  context: TenureContext = {},
): TenureType {
  const classification = classifyLandUseCode(code);
  if (explicit === undefined) return classification.defaultTenure;

  const allowed = allowedTenures(code, context);
  if (!allowed.includes(explicit)) {
    throw new BadRequestException(
      `tenureType '${TenureType[explicit]}' is not lawful for landUseCode '${code}'` +
        (context.landUserType ? ` held by '${context.landUserType}'` : '') +
        `. Allowed: ${allowed.map((t) => TenureType[t]).join(', ')}` +
        (classification.conditionalTenures
          ? `. Other tenures need specific circumstances — community land is perpetual only ` +
            `for cultural preservation (Điều 178 khoản 4), forest land only when held by a ` +
            `body assigned to manage it (Điều 171 khoản 3)`
          : ''),
    );
  }
  return explicit;
}

/** Parse the landUserType column */
export function parseLandUserType(value?: string): LandUserType | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toUpperCase();
  if (!(normalized in LandUserType)) {
    throw new BadRequestException(
      `Unknown landUserType '${value}'. Supported: ${Object.keys(LandUserType).join(', ')}`,
    );
  }
  return normalized as LandUserType;
}

/** Individual holder (Cá nhân) - applies the 50-year term limit */
export function isIndividualHolder(landUserType?: LandUserType): boolean {
  return landUserType === undefined || landUserType === LandUserType.CNV;
}

export function isOrganisation(landUserType?: LandUserType): boolean {
  return landUserType !== undefined && ORGANISATION_USER_TYPES.includes(landUserType);
}

/** Display label for the land use code (mã đất) */
export function landUseCodeLabel(code: string): string {
  return LAND_USE_CODES[normalize(code)]?.label ?? code;
}

function normalize(code: string): string {
  return code?.trim().toUpperCase();
}
