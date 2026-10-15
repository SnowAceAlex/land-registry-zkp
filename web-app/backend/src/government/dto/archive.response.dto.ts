import { ApiProperty } from '@nestjs/swagger';

/** One office's archive of one publishing round (D88). The zip bytes are never part of it. */
export class ArchiveSummaryDto {
  @ApiProperty({ example: 12 })
  changeSetId!: number;

  @ApiProperty({ example: 7, nullable: true, type: Number })
  rootVersion!: number | null;

  @ApiProperty({ nullable: true, type: Date })
  publishedAt!: Date | null;

  @ApiProperty({ example: 'CN01' })
  officeCode!: string;

  @ApiProperty({ example: 'Chi nhánh Văn phòng đăng ký đất đai CN01' })
  officeName!: string;

  /** Plots (issued + transferred) whose bundles the ZIP holds. */
  @ApiProperty({ example: 3 })
  propertyCount!: number;

  @ApiProperty()
  expiresAt!: Date;

  /** True once the TTL has passed: the secrets in it are unrecoverable. */
  @ApiProperty()
  expired!: boolean;

  @ApiProperty({ nullable: true, type: Date })
  firstDownloadedAt!: Date | null;

  @ApiProperty({ example: 'CN01', nullable: true, type: String })
  firstDownloadedByOfficeCode!: string | null;
}
