import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransferStatus } from '@prisma/client';

/**
 * transfer.response.dto.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Response shapes for the D28 transfer queue.
 */

const EXAMPLE_ROOT = '5677530015593700534173836181788122415198283309363871298832210090950018556857';

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

  /** publicSignals[1] — the root this transfer's proof commits to; published later by a change set. */
  @ApiProperty()
  newRoot!: string;

  @ApiProperty({ enum: TransferStatus, example: TransferStatus.PENDING })
  status!: TransferStatus;

  @ApiPropertyOptional({ nullable: true, example: null })
  rejectReason!: string | null;

  /** Tx hash of the change set that published this transfer; null until then. */
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

  @ApiProperty({ enum: TransferStatus, example: TransferStatus.APPROVED })
  status!: TransferStatus;

  /**
   * Approval only records the officer's decision (D46) — the root that makes
   * it effective on chain is published later, when a change set batches this
   * transfer with others and an officer signs it.
   */
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  decidedAt!: Date | null;
}

/**
 * What the registry hands back so both parties can build a transfer witness
 * (D28 step 2). Without the projected path they simply cannot run
 * transfer.circom — only the registry can compute it.
 */
export class TransferPreviewResult {
  @ApiProperty({ example: '1' })
  propertyId!: string;

  /** Current on-chain root version the old path was computed against. */
  @ApiProperty({ example: 1 })
  rootVersion!: number;

  @ApiProperty({ description: 'Current root — must still be latest when the proof is submitted' })
  oldMerkleRoot!: string;

  /** Root that WOULD result from this transfer; published later by a change set. */
  @ApiProperty()
  newMerkleRoot!: string;

  @ApiProperty({ type: [String], minItems: 20, maxItems: 20 })
  oldSiblings!: string[];

  @ApiProperty({ type: [Number], minItems: 20, maxItems: 20, example: [0, 1, 0] })
  oldPathIndices!: number[];

  @ApiProperty({ type: [String], minItems: 20, maxItems: 20 })
  newSiblings!: string[];

  @ApiProperty({ type: [Number], minItems: 20, maxItems: 20 })
  newPathIndices!: number[];
}
