import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * government.response.dto.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Response shapes for the state-authority endpoints.
 *
 * Every field that carries a BN254 field element (roots, leaves, commitments,
 * property ids) is a DECIMAL STRING, not a number: these values exceed
 * Number.MAX_SAFE_INTEGER and JSON has no bigint. The examples below are real
 * values from a local run, so the format is unambiguous.
 */

const EXAMPLE_ROOT = '5677530015593700534173836181788122415198283309363871298832210090950018556857';
const EXAMPLE_TX = '0xf4b4d599f894d6304bc42ed63af6259fe0492cd37437cbc46bc8fa398cfbbe5c';

export class ChainRootStateDto {
  @ApiProperty({ example: EXAMPLE_ROOT, description: 'Merkle root as a decimal string' })
  root!: string;

  /** Monotonic version from RootRegistry; 0 means nothing has been published. */
  @ApiProperty({ example: 1 })
  version!: number;
}

export class DatabaseRootStateDto extends ChainRootStateDto {
  @ApiProperty({ example: EXAMPLE_TX })
  txHash!: string;
}

export class RegistryStatusResponseDto {
  @ApiProperty({ example: 'localhost', enum: ['localhost', 'sepolia', 'hardhat'] })
  network!: string;

  /**
   * Chain id of that deployment (D54). A wallet on any other chain would publish
   * a root this backend never reads, so the portal checks this before signing.
   */
  @ApiProperty({ example: 31337 })
  chainId!: number;

  /** RootRegistry the backend is talking to. */
  @ApiProperty({ example: '0x5FbDB2315678afecb367f032d93F642f64180aa3' })
  contractAddress!: string;

  /** The backend's read-only chain account; should hold STATE_AUTHORITY_ROLE (D43). */
  @ApiProperty({ example: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' })
  authority!: string;

  @ApiProperty({ type: ChainRootStateDto })
  onChain!: ChainRootStateDto;

  /** Latest root the backend recorded; null before the first publish. */
  @ApiPropertyOptional({ type: DatabaseRootStateDto, nullable: true })
  database!: DatabaseRootStateDto | null;

  /**
   * False means the database and the chain disagree — usually because the chain
   * was restarted or redeployed while the database kept its rows, or because a
   * draft batch was confirmed and published the next root.
   */
  @ApiProperty({ example: true })
  inSync!: boolean;
}

export class PropertySummaryDto {
  @ApiProperty({ example: '1' })
  propertyId!: string;

  @ApiProperty({ example: 'ONT', description: 'Cadastral code; stays off-chain (D3)' })
  landUseCode!: string;

  @ApiProperty({ example: 'Số 3, Đường Nguyễn Huệ, Phường Đa Kao, Quận 1, TP.HCM' })
  address!: string;

  @ApiProperty({ example: 266.18 })
  area!: number;

  @ApiProperty({ example: 'RESIDENTIAL' })
  useType!: string;

  @ApiProperty({ example: 'PERPETUAL' })
  tenureType!: string;

  @ApiProperty({ example: 'FREE' })
  encumbranceStatus!: string;

  /** Unix seconds as a decimal string; "0" means perpetual tenure (D5). */
  @ApiProperty({ example: '0' })
  validityPeriod!: string;

  /** Poseidon([ownerSecret]); null until the property is issued. */
  @ApiPropertyOptional({ example: null, nullable: true })
  ownerCommitment!: string | null;

  /** Root version the cached Merkle proof belongs to; null before issuance. */
  @ApiPropertyOptional({ example: 1, nullable: true })
  rootVersion!: number | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  issuedAt!: Date | null;

  @ApiProperty({ example: 'IMPORTED', enum: ['IMPORTED', 'ISSUED', 'REVOKED'] })
  status!: string;
}

export class PropertyListResponseDto {
  @ApiProperty({ example: 10 })
  total!: number;

  @ApiProperty({ type: [PropertySummaryDto] })
  items!: PropertySummaryDto[];
}

/**
 * The complete record an officer sees for ONE property — `PropertySummaryDto`
 * plus every descriptive certificate field.
 *
 * Why this is a separate shape from the list: the list is a browsing view and
 * is deliberately a summary, but an officer opening a single plot is usually
 * doing exactly the thing the certificate fields exist for (checking a serial
 * against a paper record, correcting an address). Splitting them keeps the
 * list cheap without making the detail view useless.
 *
 * None of these fields ever appear on the unauthenticated `/api/records*`
 * routes — that is the whole point of the two-tier split. They are committed
 * to on chain through `offchainHash` (D36), but committing is for tamper
 * detection, not publication.
 */
export class PropertyDetailDto extends PropertySummaryDto {
  /** Số hiệu Giấy chứng nhận */
  @ApiProperty({ example: 'CT 100001' })
  certificateSerial!: string;

  /** Số vào sổ cấp GCN */
  @ApiProperty({ example: 'CS20001' })
  bookEntryNumber!: string;

  /** Đối tượng sử dụng đất (mục B TT 08/2024); null = cá nhân */
  @ApiPropertyOptional({ example: null, nullable: true })
  landUserType!: string | null;

  /** Đất cộng đồng dùng để bảo tồn bản sắc dân tộc (Điều 178 khoản 4) */
  @ApiProperty({ example: false })
  culturalPreservation!: boolean;

  /** Số tờ bản đồ */
  @ApiPropertyOptional({ example: '1', nullable: true })
  mapSheetNumber!: string | null;

  /** Nguồn gốc sử dụng đất */
  @ApiPropertyOptional({ example: 'Nhà nước công nhận quyền sử dụng đất', nullable: true })
  landOrigin!: string | null;

  @ApiProperty({ example: 'Sở Nông nghiệp và Môi trường TP.HCM' })
  issuingAuthority!: string;

  @ApiProperty({ format: 'date-time' })
  issueDate!: Date;
}
