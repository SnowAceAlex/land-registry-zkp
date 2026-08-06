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
  /** Rows written to the registry. */
  @ApiProperty({ example: 8 })
  imported!: number;

  /** Rows skipped because that propertyId already exists. */
  @ApiProperty({ example: 0 })
  skipped!: number;

  /** Rows rejected, reported individually so one bad line does not fail the file. */
  @ApiProperty({ type: [ImportRowError] })
  errors!: ImportRowError[];

  /**
   * Rows that imported but look questionable. Used where the reference data
   * shipped with the project is incomplete (the ward catalog), so rejecting
   * would risk refusing valid records — review these before issuing.
   */
  @ApiProperty({ type: [ImportRowWarning] })
  warnings!: ImportRowWarning[];
}
