import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';

/**
 * transfer.response.dto.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Response shapes for the D28 transfer queue.
 */

const EXAMPLE_ROOT = '5677530015593700534173836181788122415198283309363871298832210090950018556857';
const EXAMPLE_TX = '0xdf6ab016b71708fc6a0bd43dce0b39642d14dcb70e9693d975b443ce9e947edf';

export class TransferRequestDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '1' })
  propertyId!: string;

  @ApiProperty({ description: 'Poseidon([newOwnerSecret])' })
  newOwnerCommitment!: string;

  /** publicSignals[0] — the root the proof was generated against. */
  @ApiProperty({ example: EXAMPLE_ROOT })
  oldRoot!: string;

  /** publicSignals[1] — published only when an officer approves. */
  @ApiProperty()
  newRoot!: string;

  @ApiProperty({ enum: TransferStatus, example: TransferStatus.PENDING })
  status!: TransferStatus;

  @ApiPropertyOptional({ nullable: true, example: null })
  rejectReason!: string | null;

  /** publishRoot() transaction, set once approved. */
  @ApiPropertyOptional({ nullable: true, example: null })
  txHash!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  decidedAt!: Date | null;
}

export class TransferApprovalResponseDto {
  @ApiProperty({ example: 1, description: 'Transfer request id' })
  id!: number;

  @ApiProperty({ example: '1' })
  propertyId!: string;

  /** The newly effective root — the transfer is now on chain. */
  @ApiProperty({ example: EXAMPLE_ROOT })
  root!: string;

  @ApiProperty({ example: 2 })
  version!: number;

  @ApiProperty({ example: EXAMPLE_TX })
  txHash!: string;
}
