import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * import/dto/import.response.dto.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What POST /api/government/import reports back.
 *
 * Errors and warnings are per-row rather than a single verdict on the file: an
 * operator fixing a 500-row export needs to know which lines to correct, and
 * failing the whole upload on one bad row would make that a guessing game.
 */

export class ImportRowError {
  /** 1-based line number in the uploaded file, counting the header line. */
  @ApiProperty({ example: 3 })
  row!: number;

  @ApiPropertyOptional({ example: '2' })
  propertyId?: string;

  @ApiProperty({ example: "Unknown landUseCode 'ZZZ'" })
  message!: string;
}

export class ImportRowWarning {
  @ApiProperty({ example: 5 })
  row!: number;

  @ApiPropertyOptional({ example: '5' })
  propertyId?: string;

  @ApiProperty({ example: "ward 'Đa Kao' is not in the current administrative catalog" })
  message!: string;
}

export class ImportResult {
  /**
   * True when nothing was written (`?dryRun=true`, D52). The counts then
   * predict what the same file would do if imported for real.
   */
  @ApiProperty({ example: false })
  dryRun!: boolean;

  /** Rows written to the registry — or, on a dry run, rows that would be. */
  @ApiProperty({ example: 8 })
  imported!: number;

  /** Valid rows skipped because that propertyId already exists. */
  @ApiProperty({ example: 0 })
  skipped!: number;

  /** Rows rejected, reported individually so one bad line does not fail the file. */
  @ApiProperty({ type: [ImportRowError] })
  errors!: ImportRowError[];

  /**
   * Rows that imported but look questionable — the channel for rules where
   * rejecting would risk refusing valid records, so a human reviews them before
   * issuing. Its one former source, the unseeded ward catalog, is now reported
   * once through `catalogEmpty` (D52), so no current rule emits a row warning;
   * the field stays as the contract for the next rule that needs one.
   */
  @ApiProperty({ type: [ImportRowWarning] })
  warnings!: ImportRowWarning[];

  /**
   * The administrative-unit catalog is empty, so no commune name in this file
   * could be checked (D52). Reported once here instead of as a warning on every
   * row. Seed it with `pnpm --filter backend run seed:admin-units <file>`.
   */
  @ApiProperty({ example: false })
  catalogEmpty!: boolean;
}
