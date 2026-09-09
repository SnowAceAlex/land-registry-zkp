import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumberString, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateRevocationDto {
  /** The plot to revoke */
  @ApiProperty({ example: '1001' })
  @IsNumberString()
  propertyId!: string;

  /** 1=state reclamation, 2=issued in error, 3=dispute/court, 4=expired, 5=other */
  @ApiProperty({ minimum: 1, maximum: 5, example: 3 })
  @IsInt()
  @Min(1)
  @Max(5)
  reasonCode!: number;

  /** Free text detail. Only its keccak256 hash goes on chain (D45). */
  @ApiProperty({ example: 'Tranh chấp thừa kế theo bản án số 12/2026/DS-ST', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  // Capped because this text is relayed verbatim to the UNAUTHENTICATED history
  // endpoint (D48). Officer-entered free text about why a specific plot lost its
  // certificate is the one field in that response that is not a hash.
  @MaxLength(500)
  detailText!: string;
}
