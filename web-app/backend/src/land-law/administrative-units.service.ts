import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * AdministrativeUnitsService
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates a certificate address against the two-tier local government in
 * force since 01/7/2025 (NĐ 151/2025): an address resolves to exactly one
 * commune-level unit (phường / xã / đặc khu) inside a province, with no
 * district tier between them.
 *
 * The catalog of units lives in the database (`administrative_units`), seeded
 * from an official export — see scripts/seed-admin-units.ts. Nothing here
 * translates or repairs pre-2025 addresses: an address either resolves against
 * the current catalog or it is rejected.
 *
 * `address` is off-chain metadata (D3) and never enters the leaf hash, so a
 * mistake here is correctable later — unlike tenureType. This check exists so a
 * certificate does not print an administrative unit that no longer exists, not
 * because of immutability.
 */

export interface AddressCheck {
  errors: string[];
  warnings: string[];
}

/** Result of loading the catalog once per import run. */
export interface AddressValidator {
  check(address: string): AddressCheck;
  /** True when the catalog is empty, so ward existence could not be verified. */
  readonly catalogEmpty: boolean;
  readonly catalogSize: number;
}

const COMMUNE_PREFIX = /^(Phường|Xã|Đặc\s*khu)\s+/i;

@Injectable()
export class AdministrativeUnitsService {
  private readonly logger = new Logger(AdministrativeUnitsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load the catalog once and return a synchronous validator.
   *
   * Imports validate hundreds of rows; querying per row would turn one lookup
   * into N round trips for data that cannot change mid-file.
   */
  async createValidator(): Promise<AddressValidator> {
    const units = await this.prisma.administrativeUnit.findMany({
      select: { name: true },
    });
    const names = new Set(units.map((unit) => normalise(unit.name)));

    if (names.size === 0) {
      this.logger.warn(
        'administrative_units is empty — ward existence cannot be verified. ' +
          'Seed it with: pnpm --filter backend run seed:admin-units <file>',
      );
    }

    return {
      catalogEmpty: names.size === 0,
      catalogSize: names.size,
      check: (address: string) => checkAddress(address, names),
    };
  }
}

/**
 * Structural + catalog check.
 *
 * The structure rule does the work the old keyword blacklist did, without
 * enumerating the tiers that were abolished: a lawful address carries exactly
 * one commune-level segment, and every segment between it and the province is
 * by definition a tier that no longer exists.
 */
export function checkAddress(address: string, catalog: Set<string>): AddressCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  const segments = address
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const communeIndexes = segments
    .map((segment, index) => (COMMUNE_PREFIX.test(segment) ? index : -1))
    .filter((index) => index >= 0);

  if (communeIndexes.length === 0) {
    errors.push(
      `address must contain a commune-level unit ('Phường …', 'Xã …' or 'Đặc khu …'). ` +
        `Expected '<số nhà>, <đường>, <Phường|Xã>, <Tỉnh|Thành phố>'`,
    );
    return { errors, warnings };
  }

  if (communeIndexes.length > 1) {
    errors.push(
      `address contains ${communeIndexes.length} commune-level segments; exactly one is expected`,
    );
    return { errors, warnings };
  }

  const communeIndex = communeIndexes[0];
  const trailing = segments.slice(communeIndex + 1);

  // Province must follow the commune directly. Anything in between is the
  // district tier abolished on 01/7/2025.
  if (trailing.length === 0) {
    errors.push(`address must end with the province after '${segments[communeIndex]}'`);
  } else if (trailing.length > 1) {
    errors.push(
      `address has ${trailing.length} segments after '${segments[communeIndex]}' ` +
        `(${trailing.join(' / ')}). Since 01/7/2025 the commune is followed directly by the ` +
        `province — the district tier was abolished (NĐ 151/2025/NĐ-CP)`,
    );
  }

  const communeName = segments[communeIndex].replace(COMMUNE_PREFIX, '').trim();
  if (catalog.size === 0) {
    warnings.push(
      `could not verify that '${segments[communeIndex]}' exists — the administrative catalog ` +
        `is empty (seed it with: pnpm --filter backend run seed:admin-units <file>)`,
    );
  } else if (!catalog.has(normalise(communeName))) {
    errors.push(
      `'${segments[communeIndex]}' is not in the administrative catalog — check the name ` +
        `against the units in force since 01/7/2025`,
    );
  }

  return { errors, warnings };
}

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Bodies competent to issue a certificate under Điều 136 Luật Đất đai 2024 as
 * amended by Điều 5 NĐ 151/2025/NĐ-CP.
 *
 * A plain whitelist: an authority is either on it or the row is rejected. There
 * is deliberately no table mapping former agency names to their successors —
 * input is required to be current, not repaired.
 */
export const ISSUING_AUTHORITY_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /^(UBND|Ủy ban nhân dân)\s+(tỉnh|thành phố)\b/i, label: 'UBND cấp tỉnh' },
  {
    pattern: /^Chủ tịch (UBND|Ủy ban nhân dân)\s+(phường|xã|đặc khu)\b/i,
    label: 'Chủ tịch UBND cấp xã',
  },
  { pattern: /^Sở Nông nghiệp và Môi trường\b/i, label: 'Sở Nông nghiệp và Môi trường' },
  { pattern: /^Văn phòng đăng ký đất đai\b/i, label: 'Văn phòng đăng ký đất đai' },
];

/** @throws Error when the authority is not competent under the current law. */
export function assertIssuingAuthority(value: string): void {
  const trimmed = value.trim();
  if (!ISSUING_AUTHORITY_PATTERNS.some(({ pattern }) => pattern.test(trimmed))) {
    throw new Error(
      `issuingAuthority '${value}' is not a body competent to issue a certificate under ` +
        `Điều 136 Luật Đất đai 2024 + NĐ 151/2025. Expected one of: ` +
        `${[...new Set(ISSUING_AUTHORITY_PATTERNS.map((p) => p.label))].join(', ')}`,
    );
  }
}
