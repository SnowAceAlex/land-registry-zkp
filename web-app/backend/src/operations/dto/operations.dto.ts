import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LandOfficeKind } from '@prisma/client';

import { ALERT_CODES, ALERT_SEVERITIES, AlertCode, AlertSeverity } from '../alerts';

export class AlertDto {
  /** What happened; the portal words it, the backend never does (D89) */
  @ApiProperty({ enum: ALERT_CODES })
  code!: AlertCode;

  @ApiProperty({ enum: ALERT_SEVERITIES })
  severity!: AlertSeverity;

  @ApiPropertyOptional()
  count?: number;

  /** The office the alert is about; absent for registry-wide alerts */
  @ApiPropertyOptional({ example: 'CN07' })
  officeCode?: string;

  /** RevocationBacklog: rounds needed. Archive alerts: the change set id */
  @ApiPropertyOptional()
  ref?: number;
}

export class RegistryOverviewDto {
  @ApiProperty({ example: 'sepolia' })
  network!: string;

  @ApiProperty()
  chainId!: number;

  @ApiProperty()
  onChainVersion!: number;

  /** Decimal string of the on-chain latestRoot */
  @ApiProperty()
  onChainRoot!: string;

  @ApiProperty({ nullable: true, type: Number })
  dbVersion!: number | null;

  @ApiProperty({ nullable: true, type: Date })
  lastPublishedAt!: Date | null;

  @ApiProperty({ nullable: true, type: String })
  lastTxHash!: string | null;

  /** The database's latest root equals the chain's */
  @ApiProperty()
  inSync!: boolean;
}

export class OpenDraftSummaryDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  newRoot!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class QueueTotalsDto {
  @ApiProperty()
  issuance!: number;

  @ApiProperty()
  transfer!: number;

  @ApiProperty()
  revocation!: number;

  /** Held items are part of the three counts above; this is how many of them are held */
  @ApiProperty()
  held!: number;
}

export class OverviewDto {
  @ApiProperty({ type: RegistryOverviewDto })
  registry!: RegistryOverviewDto;

  @ApiProperty({ type: OpenDraftSummaryDto, nullable: true })
  openDraft!: OpenDraftSummaryDto | null;

  /** Open items; a branch gets only its own area */
  @ApiProperty({ type: QueueTotalsDto })
  queue!: QueueTotalsDto;

  @ApiProperty({ example: 150 })
  revocationCap!: number;

  /** Rounds the waiting (not held) revocations need at that cap */
  @ApiProperty()
  roundsNeeded!: number;

  @ApiProperty({ type: [AlertDto] })
  alerts!: AlertDto[];
}

export class OfficeRowDto {
  /** null is the row for plots not yet assigned to an office */
  @ApiProperty({ nullable: true, type: String })
  officeCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  officeName!: string | null;

  @ApiProperty({ enum: ['HEAD_OFFICE', 'SITE', 'BRANCH'], nullable: true })
  kind!: LandOfficeKind | null;

  /** Counts are by the area of the plot, whoever filed the item */
  @ApiProperty()
  issuance!: number;

  @ApiProperty()
  transfer!: number;

  @ApiProperty()
  revocation!: number;

  @ApiProperty()
  held!: number;

  /** Open transfers and revocations a central office filed on this office's plots */
  @ApiProperty()
  fallback!: number;

  /** Age of the oldest open item, in whole hours */
  @ApiProperty({ nullable: true, type: Number })
  oldestAgeHours!: number | null;
}
