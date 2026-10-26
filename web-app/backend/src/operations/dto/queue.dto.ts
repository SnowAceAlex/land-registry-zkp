import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { QUEUE_KINDS, QueueKind } from '../queue-item';

export class QueueQueryDto {
  /** Only this procedure; absent merges all three, oldest first */
  @ApiPropertyOptional({ enum: QUEUE_KINDS })
  @IsOptional()
  @IsIn(QUEUE_KINDS as unknown as string[])
  kind?: QueueKind;

  /** Only items whose plot belongs to this office (a branch may name only its own) */
  @ApiPropertyOptional({ example: 'CN01' })
  @IsOptional()
  @IsString()
  officeCode?: string;

  /** true = only held items, false = only unheld, absent = both */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  held?: boolean;

  /** Only items created more than this many days ago */
  @ApiPropertyOptional({ minimum: 0, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  olderThanDays?: number;

  @ApiPropertyOptional({ minimum: 0, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'Capped at 200', example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}

export class HoldQueueItemDto {
  /** Why the item is kept out of the next round */
  @ApiProperty({ maxLength: 500, example: 'Waiting for the court judgment' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class QueueItemDto {
  @ApiProperty({ enum: QUEUE_KINDS }) kind!: QueueKind;
  @ApiProperty() id!: number;
  @ApiProperty() propertyId!: string;
  @ApiProperty({ nullable: true, type: String }) officeCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) landOfficeCode!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() ageHours!: number;
  @ApiProperty() held!: boolean;
  @ApiProperty({ nullable: true, type: String }) heldReason!: string | null;
  @ApiProperty() byFallback!: boolean;
}

export class QueueListResponseDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [QueueItemDto] }) items!: QueueItemDto[];
}
