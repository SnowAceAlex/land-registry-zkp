import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Papa from 'papaparse';
import { MAX_PROPERTY_ID, TenureType, toUnixTimestamp } from '@land-registry/blockchain/shared';

import { PrismaService } from '../prisma/prisma.service';
import { ImportRow } from './csv-row';
import {
  ImportOfficeCount,
  ImportResult,
  ImportRowCode,
  ImportRowError,
  ImportRowWarning,
} from './dto/import.response.dto';
import {
  LandUserType,
  TenureContext,
  hasStatutoryFiftyYearTerm,
  isIndividualHolder,
  parseLandUserType,
  resolveTenureType,
  classifyLandUseCode,
} from '../land-law/land-use-code.map';
import {
  AddressValidator,
  AdministrativeUnitsService,
  assertIssuingAuthority,
} from '../land-law/administrative-units.service';
import { LineageService } from '../lineage/lineage.service';
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

/** A row failing a named rule; `code` lets the portal tell the rules apart (D90). */
class RowRuleError extends Error {
  constructor(
    readonly code: ImportRowCode,
    message: string,
  ) {
    super(message);
  }
}

interface ParsedRow {
  lineNumber: number;
  input: Prisma.PropertyCreateManyInput;
  officeCode: string | null;
  supersedes: string[];
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly administrativeUnits: AdministrativeUnitsService,
    private readonly lineage: LineageService,
  ) {}

  /**
   * Validate a CSV export and, unless `dryRun`, write the valid rows.
   *
   * A dry run exists because an IMPORTED row cannot be edited or deleted
   * through the API, while a row that is valid but wrong (a mistyped area)
   * would pass every check (D52). The commit path re-validates from scratch
   * rather than trusting an earlier dry run's verdict.
   */
  async importCsv(
    csv: string,
    { dryRun = false }: { dryRun?: boolean } = {},
  ): Promise<ImportResult> {
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
    const rows: ParsedRow[] = [];
    const seen = new Set<string>();

    const addresses = await this.administrativeUnits.createValidator();

    parsed.data.forEach((row, index) => {
      // +2: one for the header line, one for 1-based line numbers, so the
      // number in the error matches what the operator sees in their editor.
      const lineNumber = index + 2;
      try {
        const { input, rowWarnings, supersedes } = this.toCreateInput(row, addresses);
        if (seen.has(input.propertyId)) {
          errors.push({
            row: lineNumber,
            propertyId: input.propertyId,
            message: `duplicate propertyId within the file`,
          });
          return;
        }
        seen.add(input.propertyId);
        const office = addresses.officeFor(input.address);
        input.landOfficeId = office?.id ?? null;
        rows.push({ lineNumber, input, officeCode: office?.code ?? null, supersedes });
        for (const message of rowWarnings) {
          warnings.push({ row: lineNumber, propertyId: input.propertyId, message });
        }
      } catch (error) {
        errors.push({
          row: lineNumber,
          propertyId: row.propertyId,
          message: (error as Error).message,
          ...(error instanceof RowRuleError && { code: error.code }),
        });
      }
    });

    const accepted = await this.checkSupersession(rows, errors, warnings);
    errors.sort((a, b) => a.row - b.row);
    warnings.sort((a, b) => a.row - b.row);

    const catalogEmpty = addresses.catalogEmpty;

    // Same arithmetic skipDuplicates applies below, so a dry run predicts the
    // commit rather than approximating it, and only new rows get lineage edges.
    const existing = new Set(
      (
        await this.prisma.property.findMany({
          where: { propertyId: { in: accepted.map((entry) => entry.input.propertyId) } },
          select: { propertyId: true },
        })
      ).map((property) => property.propertyId),
    );
    const fresh = accepted.filter((entry) => !existing.has(entry.input.propertyId));
    const byOffice = countByOffice(fresh);

    if (dryRun) {
      return {
        dryRun,
        imported: fresh.length,
        skipped: existing.size,
        errors,
        warnings,
        catalogEmpty,
        byOffice,
      };
    }

    // skipDuplicates keeps a row that appeared since the check above from
    // failing the whole write. D90: plots and their supersession edges commit
    // together or not at all.
    const edges = fresh.flatMap((entry) =>
      entry.supersedes.map((predecessor) => ({
        predecessorPropertyId: predecessor,
        successorPropertyId: entry.input.propertyId,
      })),
    );
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.property.createMany({
        data: fresh.map((entry) => entry.input),
        skipDuplicates: true,
      }),
      this.lineage.edgesStatement(edges),
    ]);

    return {
      dryRun,
      imported: count,
      skipped: accepted.length - count,
      errors,
      warnings,
      catalogEmpty,
      byOffice,
    };
  }

  /** D90: drops rows whose predecessors fail the lineage rules; returns the rest. */
  private async checkSupersession(
    rows: ParsedRow[],
    errors: ImportRowError[],
    warnings: ImportRowWarning[],
  ): Promise<ParsedRow[]> {
    const referenced = [...new Set(rows.flatMap((entry) => entry.supersedes))];
    if (referenced.length === 0) return rows;

    const found = new Map(
      (
        await this.prisma.property.findMany({
          where: { propertyId: { in: referenced } },
          select: { propertyId: true, status: true },
        })
      ).map((property) => [property.propertyId, property.status]),
    );
    const successors = await this.lineage.successorsOf(referenced);

    return rows.filter((entry) => {
      const propertyId = entry.input.propertyId;
      const failures: { code: ImportRowCode; message: string }[] = [];
      for (const predecessor of entry.supersedes) {
        const status = found.get(predecessor);
        if (status === undefined) {
          failures.push({
            code: 'PredecessorNotFound',
            message: `supersedesPropertyIds: plot ${predecessor} is not in the registry`,
          });
        } else if (status === 'IMPORTED') {
          failures.push({
            code: 'PredecessorNeverIssued',
            message: `supersedesPropertyIds: plot ${predecessor} was never issued, so there is no certificate to replace`,
          });
        }
      }
      if (failures.length > 0) {
        for (const failure of failures) {
          errors.push({ row: entry.lineNumber, propertyId, ...failure });
        }
        return false;
      }

      for (const predecessor of entry.supersedes) {
        // The edge this same row wrote on an earlier run is not news.
        const others = (successors.get(predecessor) ?? []).filter((id) => id !== propertyId);
        if (others.length > 0) {
          warnings.push({
            row: entry.lineNumber,
            propertyId,
            code: 'PredecessorAlreadySucceeded',
            message: `plot ${predecessor} already has a successor (${others.join(', ')}); this row is recorded as another`,
          });
        }
      }
      return true;
    });
  }

  private toCreateInput(
    row: ImportRow,
    addresses: AddressValidator,
  ): {
    input: Prisma.PropertyCreateManyInput;
    rowWarnings: string[];
    supersedes: string[];
  } {
    const rowWarnings: string[] = [];

    const propertyId = requireField(row, 'propertyId');
    if (!/^\d+$/.test(propertyId)) {
      throw new Error(`propertyId must be a decimal integer string, got '${propertyId}'`);
    }
    // D41: a leaf's position in the Merkle tree IS its propertyId, so an id
    // beyond the tree's address space cannot be committed at all. Reject at
    // import rather than at publish time, where it would fail a whole batch.
    if (BigInt(propertyId) > MAX_PROPERTY_ID) {
      throw new Error(
        `propertyId ${propertyId} exceeds the addressable range of the registry tree ` +
          `(max ${MAX_PROPERTY_ID})`,
      );
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
      supersedes: parseSupersedes(row.supersedesPropertyIds, propertyId),
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

/** Splits the `1001;1002` column; every id must be a valid tree slot other than the row's own. */
function parseSupersedes(value: string | undefined, ownId: string): string[] {
  const ids = [
    ...new Set(
      (value ?? '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
  for (const id of ids) {
    if (!/^\d+$/.test(id) || BigInt(id) > MAX_PROPERTY_ID) {
      throw new RowRuleError(
        'InvalidSupersedes',
        `supersedesPropertyIds: '${id}' is not a valid propertyId (0 to ${MAX_PROPERTY_ID})`,
      );
    }
  }
  if (ids.includes(ownId)) {
    throw new RowRuleError('SelfSupersession', `plot ${ownId} cannot supersede itself`);
  }
  return ids;
}

/** Rows per office code, ordered by code with the unresolved (null) group last. */
function countByOffice(rows: ParsedRow[]): ImportOfficeCount[] {
  const counts = new Map<string | null, number>();
  for (const { officeCode } of rows) counts.set(officeCode, (counts.get(officeCode) ?? 0) + 1);
  const named = [...counts]
    .filter(([officeCode]) => officeCode !== null)
    .map(([officeCode, count]) => ({ officeCode, count }))
    .sort((a, b) => (a.officeCode! < b.officeCode! ? -1 : 1));
  const unresolved = counts.get(null);
  return unresolved === undefined ? named : [...named, { officeCode: null, count: unresolved }];
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
