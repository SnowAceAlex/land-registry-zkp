import { ApiProperty } from '@nestjs/swagger';

export class PropertyEventDto {
  /** What changed */
  @ApiProperty({
    enum: ['ISSUED', 'TRANSFERRED', 'REVOKED', 'ENCUMBRANCE_CHANGED', 'VALIDITY_CHANGED'],
  })
  kind!: string;

  /** Root version this change took effect in; null while not yet published */
  @ApiProperty({ nullable: true, type: Number })
  rootVersion!: number | null;

  /** publishRoot transaction hash */
  @ApiProperty({ nullable: true, type: String })
  txHash!: string | null;

  /** Pseudonymous owner commitment before the change (D8) */
  @ApiProperty({ nullable: true, type: String })
  previousOwnerCommitment!: string | null;

  /** Pseudonymous owner commitment after the change (D8) */
  @ApiProperty({ nullable: true, type: String })
  newOwnerCommitment!: string | null;

  /** Poseidon leaf before the change */
  @ApiProperty({ nullable: true, type: String })
  previousLeaf!: string | null;

  /** Poseidon leaf after the change */
  @ApiProperty({ nullable: true, type: String })
  newLeaf!: string | null;

  /**
   * Kind-specific extras, e.g. { reasonCode, detailHash } for a revocation.
   * Only the on-chain-readable reason code and keccak256(detailText) ever
   * appear here — the free-text reason stays off-chain by design and is
   * never returned by this public endpoint.
   */
  @ApiProperty({ nullable: true, type: Object })
  detail!: unknown;

  @ApiProperty()
  occurredAt!: Date;
}

export class PropertyHistoryResponseDto {
  @ApiProperty()
  propertyId!: string;

  @ApiProperty({ type: [PropertyEventDto] })
  events!: PropertyEventDto[];
}
