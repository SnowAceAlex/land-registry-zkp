import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DECIMAL_STRING = /^\d+$/;

const EXAMPLE_COMMITMENT =
  '19897067188519289101513059926301937407996214561223222508148918589381936293';

export class TransferPreviewDto {
  @ApiProperty({ example: '1' })
  @IsString()
  @Matches(DECIMAL_STRING, { message: 'propertyId must be a decimal integer string' })
  propertyId!: string;
}

export class SubmitTransferDto {
  @ApiProperty({ example: '1' })
  @IsString()
  @Matches(DECIMAL_STRING)
  propertyId!: string;

  @ApiProperty({ example: EXAMPLE_COMMITMENT })
  @IsString()
  @Matches(DECIMAL_STRING)
  newOwnerCommitment!: string;

  /**
   * The secret POST /transfers/preview issued for the buyer (D77). Stored with
   * the request until the change set's archive carries it to the buyer, then
   * cleared. Must open newOwnerCommitment.
   */
  @ApiProperty({
    example: '142180644374671002705865094078679040625424712395800384724292556060244418588',
  })
  @IsString()
  @Matches(DECIMAL_STRING, { message: 'newOwnerSecret must be a decimal field element' })
  newOwnerSecret!: string;

  /**
   * Groth16 proof as emitted by snarkjs (`pi_a`, `pi_b`, `pi_c`, `protocol`,
   * `curve`). Generate it with
   * `pnpm --filter blockchain run transfer:smoke <bundle-dir>` — it cannot be
   * written by hand.
   */
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { pi_a: ['...'], pi_b: [['...']], pi_c: ['...'], protocol: 'groth16', curve: 'bn128' },
  })
  @IsObject()
  proof!: Record<string, unknown>;

  /**
   * Exactly 7 values in PUBLIC_SIGNAL_ORDER.transfer (D21):
   * oldMerkleRoot, newMerkleRoot, propertyId, oldOwnerCommitment,
   * newOwnerCommitment, currentTimestamp, minRequiredRemainingTerm.
   */
  @ApiProperty({
    type: [String],
    minItems: 7,
    maxItems: 7,
    example: ['<oldRoot>', '<newRoot>', '1', '<oldCommit>', '<newCommit>', '1785312000', '0'],
  })
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @IsString({ each: true })
  publicSignals!: string[];
}

export class RejectTransferDto {
  @ApiPropertyOptional({ example: 'Hồ sơ công chứng không hợp lệ', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
