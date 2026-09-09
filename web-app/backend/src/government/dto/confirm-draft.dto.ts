import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Phase 2 (confirm) body for both two-phase draft flows (D43 issuance /
 * D44 change-set).
 *
 * `txHash` is a convenience label for the publish transaction — surfaced
 * later in history views so a human can jump to a block explorer. It is
 * NEVER evidence that the publish happened: that authority stays exactly
 * ChainService.getLatestRoot(), read fresh from the chain inside confirm().
 * Validated as shape only (0x + 32 bytes hex); its presence, absence or
 * value must never change what confirm() decides to do.
 */
export class ConfirmDraftDto {
  /** The publish transaction hash, for display only — shape-validated, never trusted as proof. */
  @ApiPropertyOptional({
    example: '0xabcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
    pattern: '^0x[0-9a-fA-F]{64}$',
  })
  @IsOptional()
  @IsString()
  @Matches(TX_HASH_PATTERN, { message: 'txHash must be a 0x-prefixed 32-byte hex string' })
  txHash?: string;
}
