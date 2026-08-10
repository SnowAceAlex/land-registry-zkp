import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString, Matches } from 'class-validator';

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
