import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Papa from 'papaparse';
import { TenureType, toUnixTimestamp } from '@land-registry/blockchain/shared';

import { PrismaService } from '../prisma/prisma.service';
import { ImportResult, ImportRow, ImportRowError, ImportRowWarning } from './dto/import.dto';
import {
  LandUserType,
  TenureContext,
  hasStatutoryFiftyYearTerm,
  isIndividualHolder,
  parseLandUserType,
  resolveTenureType,
  classifyLandUseCode,
} from './land-use-code.map';
import {
  AddressValidator,
  AdministrativeUnitsService,
  assertIssuingAuthority,
} from './administrative-units.service';
import { encumbranceStatusName, tenureTypeName, useTypeName } from '../records/record.mapper';

/**
 * ImportService
 * ─────────────────────────────────────────────────────────────────────────────
 * Bulk-loads land records from a CSV export into Postgres.
 */

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const DAYS_PER_YEAR = 365.2425;
const INDIVIDUAL_AGRICULTURAL_TERM_YEARS = 50;
const PROJECT_TERM_YEARS = 50;
const LONG_TERM_PROJECT_YEARS = 70;

const TERM_TOLERANCE_DAYS = 366;

const CERTIFICATE_SERIAL_PATTERN = /^[A-ZĐ]{2}\s?\d{6}$/i;

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly administrativeUnits: AdministrativeUnitsService,
  ) {}

  async importCsv(csv: string): Promise<ImportResult> {
    const parsed = Papa.parse<ImportRow>(csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      transform: (value) => value.trim(),
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      throw new BadRequestException(
        `Could not parse the CSV: ${parsed.errors.map((e) => e.message).join('; ')}`,
      );
    }

    const errors: ImportRowError[] = [];
    const warnings: ImportRowWarning[] = [];
    const creates: Prisma.PropertyCreateManyInput[] = [];
    const seen = new Set<string>();

    const addresses = await this.administrativeUnits.createValidator();

    parsed.data.forEach((row, index) => {
      // +2: one for the header line, one for 1-based line numbers, so the
      // number in the error matches what the operator s  ees in their editor.
      const lineNumber = index + 2;
      try {
        const { input, rowWarnings } = this.toCreateInput(row, addresses);
        if (seen.has(input.propertyId)) {
          errors.push({
            row: lineNumber,
            propertyId: input.propertyId,
            message: `duplicate propertyId within the file`,
          });
          return;
        }
        seen.add(input.propertyId);
        creates.push(input);
        for (const message of rowWarnings) {
          warnings.push({ row: lineNumber, propertyId: input.propertyId, message });
        }
      } catch (error) {
        errors.push({
          row: lineNumber,
          propertyId: row.propertyId,
          message: (error as Error).message,
        });
      }
    });

    // skipDuplicates keeps a re-run of the same file from failing wholesale on
    // records already in the registry.
    const { count } = await this.prisma.property.createMany({
      data: creates,
      skipDuplicates: true,
    });

    return { imported: count, skipped: creates.length - count, errors, warnings };
  }

  private toCreateInput(
    row: ImportRow,
    addresses: AddressValidator,
  ): {
    input: Prisma.PropertyCreateManyInput;
    rowWarnings: string[];
  } {
    const rowWarnings: string[] = [];

    const propertyId = requireField(row, 'propertyId');
    if (!/^\d+$/.test(propertyId)) {
      throw new Error(`propertyId must be a decimal integer string, got '${propertyId}'`);
    }

    const landUseCode = requireField(row, 'landUseCode').toUpperCase();
    const { useType } = classifyLandUseCode(landUseCode);
    const landUserType = parseLandUserType(row.landUserType);
    const tenureContext: TenureContext = {
      landUserType,
      culturalPreservation: parseBoolean(row.culturalPreservation),
    };
    const tenureType = resolveTenureType(
      landUseCode,
      parseTenureType(row.tenureType),
      tenureContext,
    );

    const area = Number(requireField(row, 'area').replace(/,/g, ''));
    if (!Number.isFinite(area) || area <= 0) {
      throw new Error(`area must be a positive number, got '${row.area}'`);
    }

    const certificateSerial = requireField(row, 'certificateSerial');
    if (!CERTIFICATE_SERIAL_PATTERN.test(certificateSerial)) {
      throw new Error(
        `certificateSerial must be 2 letters followed by 6 digits (e.g. 'CT 100001'), ` +
          `got '${certificateSerial}'`,
      );
    }

    const issuingAuthority = requireField(row, 'issuingAuthority');
    assertIssuingAuthority(issuingAuthority);

    const address = requireField(row, 'address');
    const addressCheck = addresses.check(address);
    if (addressCheck.errors.length > 0) {
      throw new Error(addressCheck.errors.join('; '));
    }
    rowWarnings.push(...addressCheck.warnings);

    const issueDate = parseVietnameseDate(requireField(row, 'issueDate'));
    const validityPeriod = this.resolveValidityPeriod(
      row,
      tenureType,
      issueDate,
      landUseCode,
      landUserType,
    );

    return {
      input: {
        propertyId,
        ownerCommitment: null,
        useType: useTypeName(useType),
        validityPeriod,
        encumbranceStatus: parseEncumbrance(row.encumbranceStatus),
        tenureType: tenureTypeName(tenureType),
        landUseCode,
        landUserType: landUserType ?? null,
        culturalPreservation: tenureContext.culturalPreservation ?? false,
        certificateSerial,
        bookEntryNumber: requireField(row, 'bookEntryNumber'),
        mapSheetNumber: row.mapSheetNumber || null,
        landOrigin: row.landOrigin || null,
        address,
        area: new Prisma.Decimal(area.toFixed(2)),
        issuingAuthority,
        issueDate,
      },
      rowWarnings,
    };
  }

  /**
   * Perpetual tenure uses the 0 sentinel (D5) — the circuits skip the term
   * check for it, so an expiry date on such a record would be silently
   * meaningless. Cross-validating both directions turns that into an error the
   * operator can fix (invariant A16: PERPETUAL ⟺ validityPeriod == 0).
   */
  private resolveValidityPeriod(
    row: ImportRow,
    tenureType: TenureType,
    issueDate: Date,
    landUseCode: string,
    landUserType?: LandUserType,
  ): string {
    const hasExpiry = Boolean(row.expiryDate);

    if (tenureType === TenureType.PERPETUAL) {
      if (hasExpiry) {
        throw new Error(
          `landUseCode '${row.landUseCode}' is being registered as perpetual tenure, which has ` +
            `no expiry date, but expiryDate='${row.expiryDate}' was given`,
        );
      }
      return '0';
    }

    if (!hasExpiry) {
      throw new Error(
        `tenureType '${TenureType[tenureType]}' has a limited term, so expiryDate is required`,
      );
    }

    const expiryDate = parseVietnameseDate(row.expiryDate!);

    if (expiryDate.getTime() <= issueDate.getTime()) {
      throw new Error(`expiryDate (${row.expiryDate}) must be after issueDate (${row.issueDate})`);
    }

    this.assertStatutoryTerm(row, tenureType, issueDate, expiryDate, landUseCode, landUserType);

    return toUnixTimestamp(expiryDate).toString();
  }

  private assertStatutoryTerm(
    row: ImportRow,
    tenureType: TenureType,
    issueDate: Date,
    expiryDate: Date,
    landUseCode: string,
    landUserType?: LandUserType,
  ): void {
    const years = termYears(issueDate, expiryDate);
    const toleranceYears = TERM_TOLERANCE_DAYS / DAYS_PER_YEAR;

    // The fixed 50-year term applies only to the categories Điều 172 khoản 1
    // điểm a lists. Codes outside it (CNT, RSN) have a term set by a different
    // rule, so asserting 50 years for them would reject lawful records.
    if (
      tenureType === TenureType.FIXED_TERM &&
      isIndividualHolder(landUserType) &&
      hasStatutoryFiftyYearTerm(landUseCode)
    ) {
      if (Math.abs(years - INDIVIDUAL_AGRICULTURAL_TERM_YEARS) > toleranceYears) {
        throw new Error(
          `term is ${years.toFixed(1)} years, but allocation/recognition to an individual is ` +
            `${INDIVIDUAL_AGRICULTURAL_TERM_YEARS} years (Điều 172 khoản 1 điểm a Luật Đất đai 2024). ` +
            `Set expiryDate to ${INDIVIDUAL_AGRICULTURAL_TERM_YEARS} years after issueDate, or set ` +
            `landUserType if the land is leased or held by an organisation`,
        );
      }
      return;
    }

    if (tenureType === TenureType.PROJECT_LEASEHOLD) {
      const isLongTerm = parseBoolean(row.isLongTermInvestmentProject);
      const cap = isLongTerm ? LONG_TERM_PROJECT_YEARS : PROJECT_TERM_YEARS;
      if (years > cap + toleranceYears) {
        throw new Error(
          `term is ${years.toFixed(1)} years, which exceeds the ${cap}-year cap for a project ` +
            `lease (Điều 172 khoản 1 điểm c)` +
            (isLongTerm
              ? ''
              : `. Set isLongTermInvestmentProject=true if the investment project runs over ` +
                `${PROJECT_TERM_YEARS} years under Luật Đầu tư`),
        );
      }
    }
  }
}

function requireField(row: ImportRow, field: keyof ImportRow): string {
  const value = row[field];
  if (!value) {
    throw new Error(`missing required column '${field}'`);
  }
  return value;
}

function parseEncumbrance(value?: string): Prisma.PropertyCreateManyInput['encumbranceStatus'] {
  if (!value) return encumbranceStatusName(0);

  const normalized = value.trim().toUpperCase();
  const allowed = ['FREE', 'MORTGAGED', 'LITIGATED', 'RESTRICTED'];
  if (!allowed.includes(normalized)) {
    throw new Error(`encumbranceStatus must be one of ${allowed.join(', ')}, got '${value}'`);
  }
  return normalized as Prisma.PropertyCreateManyInput['encumbranceStatus'];
}

/** Optional tenureType column; the map decides whether the value is lawful. */
function parseTenureType(value?: string): TenureType | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toUpperCase();
  const parsed = TenureType[normalized as keyof typeof TenureType];
  if (parsed === undefined) {
    throw new Error(
      `tenureType must be one of PERPETUAL, FIXED_TERM, PROJECT_LEASEHOLD, got '${value}'`,
    );
  }
  return parsed;
}

function parseBoolean(value?: string): boolean {
  return ['true', '1', 'yes', 'y'].includes((value ?? '').trim().toLowerCase());
}

function termYears(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (SECONDS_PER_YEAR * 1000);
}

/** DD/MM/YYYY as used on Vietnamese land certificates. */
export function parseVietnameseDate(value: string): Date {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) {
    throw new Error(`date must be in DD/MM/YYYY format, got '${value}'`);
  }
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`'${value}' is not a valid date`);
  }
  // Guards against 31/02/2020 rolling over into March.
  if (date.getUTCDate() !== Number(day) || date.getUTCMonth() + 1 !== Number(month)) {
    throw new Error(`'${value}' is not a valid calendar date`);
  }
  return date;
}
