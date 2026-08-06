/**
 * import/csv-row.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The shape of a bulk-import CSV row.
 *
 * Not a DTO: nothing here is validated by class-validator or documented in
 * OpenAPI, because the request body is a multipart file, not JSON. These are the
 * column names the parser reads — a description of the FILE format, which is why
 * they live beside the service that parses them rather than in dto/.
 */

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
