import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString, Matches } from 'class-validator';

/**
 * One row of the bulk-import CSV. Column names are the CSV headers.
 *
 * Note what is NOT here: `ownerCommitment`, `useType` and `tenureType`. The
 * first is generated at issue time (D14); the other two are derived from
 * `landUseCode` (D2) rather than trusted from the file, so a typo cannot put a
 * wrong tenure into an immutable leaf hash.
 */
export interface ImportRow {
  propertyId: string;
  /** Code from Phụ lục II TT 08/2024; pre-2024 codes are rejected */
  landUseCode: string;
  /**
   * PERPETUAL | FIXED_TERM | PROJECT_LEASEHOLD. Optional — omitted means the
   * ordinary tenure for the code. Supplied because the term follows how the
   * State granted the land, not the land category (Điều 171); the value is
   * validated against `landUseCode` + `landUserType` (revised D2).
   */
  tenureType?: string;
  /** CNV | CDS | TKT | TCN | TSN — đối tượng sử dụng đất; defaults to individual */
  landUserType?: string;
  /**
   * true when community land is used to preserve ethnic cultural identity —
   * the condition that makes it perpetual (Điều 178 khoản 4).
   */
  culturalPreservation?: string;
  certificateSerial: string;
  bookEntryNumber: string;
  /** Số tờ bản đồ — printed on the certificate */
  mapSheetNumber?: string;
  /** Nguồn gốc sử dụng đất — printed on the certificate */
  landOrigin?: string;
  address: string;
  area: string;
  issuingAuthority: string;
  /** DD/MM/YYYY, Vietnam local time */
  issueDate: string;
  /** DD/MM/YYYY. Required unless the tenure is perpetual; must be absent if it is. */
  expiryDate?: string;
  /** FREE | MORTGAGED | LITIGATED | RESTRICTED — defaults to FREE */
  encumbranceStatus?: string;
  /** true raises the project-lease cap from 50 to 70 years (Điều 172 khoản 1 điểm c) */
  isLongTermInvestmentProject?: string;
}

export const IMPORT_COLUMNS: (keyof ImportRow)[] = [
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
];

export class IssueBatchDto {
  /**
   * Properties to issue together. One Merkle root publish covers the whole
   * batch — the point of batching (gas) — and every owner in it gets their own
   * bundle afterwards.
   */
  @ApiProperty({ example: ['1', '2', '3'], description: 'Decimal-string property ids' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true, message: 'propertyId must be a decimal integer string' })
  propertyIds!: string[];
}

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
