import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The argument lists of RootRegistry.freezeOwners (D79), as decimal strings. */
export class FreezeCalldataDto {
  @ApiProperty({ example: ['1001'] })
  propertyIds!: string[];

  @ApiProperty({ example: ['1234567890123456789'] })
  ownerCommitments!: string[];
}

/** The one procedure a plot may have open (D80). */
export class OpenProcedureDto {
  @ApiProperty({ enum: ['transfer', 'revocation'] })
  kind!: 'transfer' | 'revocation';

  /** TransferRequest.id or Revocation.id. */
  @ApiProperty({ example: 12 })
  id!: number;

  /** Transfers only. */
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED'] })
  status?: 'PENDING' | 'APPROVED';
}

export class FreezeStatusDto {
  @ApiProperty({ example: '1001' })
  propertyId!: string;

  /** The current owner's commitment — the value a freeze has to name. */
  @ApiProperty({ example: '1234567890123456789' })
  ownerCommitment!: string;

  /** RootRegistry.frozenOwner(propertyId) equals `ownerCommitment`. */
  @ApiProperty({ example: false })
  frozenOnChain!: boolean;

  @ApiPropertyOptional({ type: OpenProcedureDto, nullable: true })
  openProcedure!: OpenProcedureDto | null;

  @ApiProperty({ type: FreezeCalldataDto })
  freezeCalldata!: FreezeCalldataDto;

  /** frozenOnChain AND no open procedure — only then may unfreezeOwners be signed. */
  @ApiProperty({ example: false })
  unfreezeAllowed!: boolean;
}
