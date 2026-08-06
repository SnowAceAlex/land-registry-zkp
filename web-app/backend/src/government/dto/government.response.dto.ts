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

const EXAMPLE_ROOT =
  '5677530015593700534173836181788122415198283309363871298832210090950018556857';
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

  /** RootRegistry the backend is talking to. */
  @ApiProperty({ example: '0x5FbDB2315678afecb367f032d93F642f64180aa3' })
  contractAddress!: string;

  /** Account that signs publishRoot(); must hold STATE_AUTHORITY_ROLE. */
  @ApiProperty({ example: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' })
  authority!: string;

  @ApiProperty({ type: ChainRootStateDto })
  onChain!: ChainRootStateDto;

  /** Latest root the backend recorded; null before the first publish. */
  @ApiPropertyOptional({ type: DatabaseRootStateDto, nullable: true })
  database!: DatabaseRootStateDto | null;

  /**
   * False means the database and the chain disagree — usually because the chain
   * was restarted or redeployed while the database kept its rows. Publishing a
   * root reconciles them.
   */
  @ApiProperty({ example: true })
  inSync!: boolean;
}

export class PublishRootResponseDto {
  @ApiProperty({ example: EXAMPLE_ROOT })
  root!: string;

  @ApiProperty({ example: 2 })
  version!: number;

  /** Null when nothing needed publishing — no transaction was sent. */
  @ApiPropertyOptional({ example: EXAMPLE_TX, nullable: true })
  txHash!: string | null;

  /**
   * False means the rebuilt root already matched the chain. RootRegistry
   * rejects re-publishing the current root, so the backend skips the
   * transaction instead of sending one that would revert.
   */
  @ApiProperty({ example: true })
  published!: boolean;

  @ApiProperty({ example: 'Published root version 2' })
  message!: string;
}

export class IssuedBundleManifestEntryDto {
  @ApiProperty({ example: '1' })
  propertyId!: string;

  /**
   * Single-use download path. The bundle is deleted the moment it is fetched,
   * so this link works exactly once.
   */
  @ApiProperty({
    example: '/api/bundles/claim/a4638d869008df08b02d6744ffec1e4933c29742ee1cd0e50e26ca5cd4eb2b97',
  })
  claimUrl!: string;

  @ApiProperty({ example: '2026-08-10T04:16:16.829Z', format: 'date-time' })
  expiresAt!: Date;
}

export class IssueBatchResponseDto {
  @ApiProperty({ example: EXAMPLE_ROOT })
  root!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  /** One transaction covers the whole batch — that is the point of batching. */
  @ApiProperty({ example: EXAMPLE_TX })
  txHash!: string;

  @ApiProperty({ type: [IssuedBundleManifestEntryDto] })
  bundles!: IssuedBundleManifestEntryDto[];
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

  @ApiProperty({ example: 'IMPORTED', enum: ['IMPORTED', 'ISSUED'] })
  status!: string;
}

export class PropertyListResponseDto {
  @ApiProperty({ example: 10 })
  total!: number;

  @ApiProperty({ type: [PropertySummaryDto] })
  items!: PropertySummaryDto[];
}
