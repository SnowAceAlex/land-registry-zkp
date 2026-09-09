import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * record.response.dto.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The public projection of a property row, returned by the unauthenticated
 * `GET /api/records` and `GET /api/records/:propertyId`.
 *
 * Every field here is already public through another route or the chain
 * itself: `propertyId`/`ownerCommitment` are public circuit signals, `leaf`
 * is the Poseidon leaf hash `GET /api/proof/:propertyId` already discloses,
 * `status` mirrors the on-chain `revocations` mapping, `rootVersion` is a
 * cache-freshness counter. The descriptive certificate fields (address, area,
 * certificate serial, …) and internal columns (id, createdAt, updatedAt,
 * issuedAt, issuanceBatchId) are deliberately absent — see
 * `GET /api/government/properties/:propertyId` for the guarded full record.
 */
export class RecordPublicDto {
  @ApiProperty({ example: '1', description: 'Decimal-string id; also the leaf index (D41)' })
  propertyId!: string;

  /** Poseidon([ownerSecret]); null until the property is issued. */
  @ApiPropertyOptional({ example: null, nullable: true })
  ownerCommitment!: string | null;

  @ApiProperty({ example: 'ISSUED', enum: ['IMPORTED', 'ISSUED', 'REVOKED'] })
  status!: string;

  /** Poseidon leaf hash, decimal string; null until issued. */
  @ApiPropertyOptional({ example: null, nullable: true })
  leaf!: string | null;

  /** Root version the cached Merkle proof belongs to; null before issuance. */
  @ApiPropertyOptional({ example: 1, nullable: true })
  rootVersion!: number | null;
}

export class RecordListResponseDto {
  @ApiProperty({ example: 10 })
  total!: number;

  @ApiProperty({ type: [RecordPublicDto] })
  items!: RecordPublicDto[];
}
