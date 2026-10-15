import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssuanceRequestStatus } from '@prisma/client';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, Matches } from 'class-validator';

export class CreateIssuanceRequestsDto {
  /** Decimal-string propertyIds to queue for issuance */
  @ApiProperty({ type: [String], example: ['1001', '1002'], maxItems: 500 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @Matches(/^\d+$/, { each: true })
  propertyIds!: string[];
}

export class IssuanceRequestDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '1001' })
  propertyId!: string;

  @ApiProperty({ description: 'Poseidon([ownerSecret]); the secret itself is never returned' })
  ownerCommitment!: string;

  @ApiProperty({ enum: IssuanceRequestStatus })
  status!: IssuanceRequestStatus;

  @ApiProperty({ example: 'HQ' })
  officeCode!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'CN01' })
  landOfficeCode!: string | null;

  @ApiProperty()
  held!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  heldReason!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  changeSetId!: number | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ type: Date, nullable: true })
  publishedAt!: Date | null;
}
