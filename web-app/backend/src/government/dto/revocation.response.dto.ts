import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RevocationStatus } from '@prisma/client';

export class RevocationDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '1001' })
  propertyId!: string;

  /** 1=state reclamation, 2=issued in error, 3=dispute/court, 4=expired, 5=other */
  @ApiProperty({ minimum: 1, maximum: 5, example: 3 })
  reasonCode!: number;

  /** Free text; kept off the chain and off the public history, shown to officers only. */
  @ApiProperty()
  detailText!: string;

  /** keccak256(detailText) — the value that goes on chain. */
  @ApiProperty()
  detailHash!: string;

  @ApiProperty({ enum: RevocationStatus, example: RevocationStatus.PENDING })
  status!: RevocationStatus;

  /** Code of the office that filed the revocation. */
  @ApiProperty({ nullable: true, type: String, example: 'CN01' })
  officeCode!: string | null;

  /** Code of the office that manages the plot's area; null while the plot is unassigned. */
  @ApiProperty({ nullable: true, type: String, example: 'CN01' })
  landOfficeCode!: string | null;

  /** True when a different office than the plot's own filed it (the central fallback). */
  @ApiProperty({ example: false })
  byFallback!: boolean;

  /** True while an officer holds it out of the next change set. */
  @ApiProperty({ example: false })
  held!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  heldReason!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  changeSetId!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, type: Date, format: 'date-time' })
  publishedAt!: Date | null;
}
