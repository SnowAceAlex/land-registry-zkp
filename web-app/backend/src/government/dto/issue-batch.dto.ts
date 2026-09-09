import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsNumberString } from 'class-validator';

/** D43 — phase 1 of the two-phase issuance draft flow. */
export class CreateIssuanceDraftDto {
  /** Decimal-string propertyIds to issue in this round */
  @ApiProperty({ type: [String], example: ['1001', '1002'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsNumberString({}, { each: true })
  propertyIds!: string[];
}
