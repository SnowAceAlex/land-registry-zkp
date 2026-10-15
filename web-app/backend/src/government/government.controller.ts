import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IssuanceRequestStatus } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';

import { ApiKeyGuard, GOV_API_KEY_HEADER, GOV_API_KEY_SECURITY } from '../common/api-key.guard';
import { Actor } from '../common/actor';
import { CentralOnly } from '../common/central-only.guard';
import { CurrentActor } from '../common/current-actor.decorator';
import { parsePageQuery } from '../common/pagination';
import { ChangeSetService } from './changeset.service';
import { GovernmentService, parsePropertyStatus } from './government.service';
import { ImportService } from '../import/import.service';
import { ImportResult } from '../import/dto/import.response.dto';
import {
  CreateIssuanceRequestsDto,
  IssuanceRequestDto,
} from '../issuance/dto/issuance-request.dto';
import { IssuanceRequestService } from '../issuance/issuance-request.service';
import { ArchiveSummaryDto } from './dto/archive.response.dto';
import { ConfirmDraftDto } from './dto/confirm-draft.dto';
import { CreateRevocationDto } from './dto/revocation.dto';
import {
  PropertyListResponseDto,
  PropertyDetailDto,
  RegistryStatusResponseDto,
  MeResponseDto,
} from './dto/government.response.dto';
import { OpenDraftService } from './open-draft.service';
import { RevocationService } from './revocation.service';
import { RoundArchiveService } from './round-archive.service';

const ISSUANCE_REQUEST_STATUSES = ['READY', 'PUBLISHED', 'WITHDRAWN'] as const;

function parseIssuanceRequestStatus(raw?: string): IssuanceRequestStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!(ISSUANCE_REQUEST_STATUSES as readonly string[]).includes(raw)) {
    throw new BadRequestException(`status must be one of ${ISSUANCE_REQUEST_STATUSES.join(', ')}`);
  }
  return raw as IssuanceRequestStatus;
}

@ApiTags('Government')
@ApiSecurity(GOV_API_KEY_SECURITY)
@ApiUnauthorizedResponse({ description: `Missing or invalid ${GOV_API_KEY_HEADER} header` })
// Exempt from the global rate limit (see AppModule): these routes already sit
// behind ApiKeyGuard, and a legitimate bulk import or multi-property issuance
// round trips easily exceeds the public 60/minute default.
@SkipThrottle()
@Controller('government')
@UseGuards(ApiKeyGuard)
export class GovernmentController {
  constructor(
    private readonly government: GovernmentService,
    private readonly importService: ImportService,
    private readonly issuanceRequests: IssuanceRequestService,
    private readonly revocations: RevocationService,
    private readonly changeSets: ChangeSetService,
    private readonly openDrafts: OpenDraftService,
    private readonly roundArchives: RoundArchiveService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Which office the supplied API key belongs to',
    description: 'D86: the portal reads `scope` to decide which actions to show.',
  })
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentActor() actor: Actor): MeResponseDto {
    return {
      office: { code: actor.officeCode, name: actor.officeName, kind: actor.officeKind },
      scope: actor.scope,
    };
  }

  @Get('status')
  @ApiOperation({
    summary: 'Registry state on chain vs. in the database',
    description:
      'Use `inSync` as the health check while testing: false means the chain was restarted or ' +
      'redeployed while the database kept its rows, or a draft batch published a newer root.',
  })
  @ApiOkResponse({ type: RegistryStatusResponseDto })
  status() {
    return this.government.registryStatus();
  }

  @Get('properties')
  @ApiOperation({ summary: 'List properties with their issuance status' })
  @ApiQuery({ name: 'skip', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'take', required: false, type: Number, example: 50, description: 'Max 200' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['IMPORTED', 'ISSUED', 'REVOKED'],
    description: 'Only this status; `total` is counted under the same filter',
  })
  @ApiOkResponse({ type: PropertyListResponseDto })
  listProperties(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('status') status?: string,
  ) {
    return this.government.listProperties(parsePageQuery(skip, take), parsePropertyStatus(status));
  }

  @Get('properties/:propertyId')
  @ApiOperation({
    summary: 'Get one property with its full descriptive fields',
    description:
      'The guarded counterpart of GET /api/records/:propertyId: that public route returns only ' +
      'propertyId/ownerCommitment/status/leaf/rootVersion, this one returns the full row for an ' +
      'authenticated officer.',
  })
  @ApiOkResponse({ type: PropertyDetailDto })
  getProperty(@Param('propertyId') propertyId: string) {
    return this.government.getProperty(propertyId);
  }

  //CSV Import
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Bulk import land records from CSV',
    description:
      'Columns: propertyId, landUseCode, certificateSerial, bookEntryNumber, address, area, ' +
      'issuingAuthority, issueDate (DD/MM/YYYY), expiryDate (DD/MM/YYYY, omit for perpetual ' +
      'tenure), encumbranceStatus, and optionally supersedesPropertyIds (`1001;1002`: the ' +
      'issued certificates this one replaces — D90; the land office is derived from the ' +
      'address commune, D85). `useType` and `tenureType` are derived server-side from ' +
      '`landUseCode` (D2) rather than read from the file, so a typo cannot reach a leaf hash. ' +
      'Bad rows are reported individually and the rest still import. ' +
      'Send `?dryRun=true` first to see the per-row verdict without writing anything (D52) — ' +
      'an imported row cannot be edited or deleted through the API. ' +
      'Sample file: blockchain/fixtures/mockImport.csv.',
  })
  @ApiQuery({
    name: 'dryRun',
    required: false,
    type: Boolean,
    description: 'Validate and count, write nothing',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ImportResult })
  async import(@UploadedFile() file?: Express.Multer.File, @Query('dryRun') dryRun?: string) {
    if (!file) {
      throw new BadRequestException("Upload a CSV file in the 'file' field");
    }
    return this.importService.importCsv(file.buffer.toString('utf8'), {
      dryRun: dryRun === 'true',
    });
  }

  @Get('drafts/open')
  @ApiOperation({
    summary: 'The draft currently waiting to be signed, if any (D53)',
    description:
      'At most one change-set draft exists (D44). Returns ' +
      '`{ draft: null }` when none is open; otherwise the same shape its create call returned — ' +
      'for a change set that includes the revocationCalldata to sign. This is how a portal ' +
      'resumes after losing the create response: compare `newRoot` with the on-chain ' +
      'latestRoot to decide between signing again and calling confirm.',
  })
  openDraft() {
    return this.openDrafts.current();
  }

  @Post('issuance-requests')
  @CentralOnly()
  @ApiOperation({
    summary: 'Queue plots for issuance (central office only)',
    description:
      'D87: generates each owner secret now and keeps it on the request; the plot stays ' +
      'IMPORTED until a change set confirms.',
  })
  @ApiOkResponse({ type: [IssuanceRequestDto] })
  @ApiConflictResponse({
    description:
      'A plot is not IMPORTED, is already queued, or supersedes a certificate that is not ' +
      'REVOKED yet (reason PredecessorNotRevoked, D90)',
  })
  requestIssuance(@Body() dto: CreateIssuanceRequestsDto, @CurrentActor() actor: Actor) {
    return this.issuanceRequests.request(dto.propertyIds, actor);
  }

  @Get('issuance-requests')
  @CentralOnly()
  @ApiOperation({ summary: 'List issuance requests (central office only)' })
  @ApiQuery({ name: 'status', required: false, enum: ['READY', 'PUBLISHED', 'WITHDRAWN'] })
  @ApiOkResponse({ type: [IssuanceRequestDto] })
  listIssuanceRequests(@CurrentActor() actor: Actor, @Query('status') status?: string) {
    return this.issuanceRequests.list(parseIssuanceRequestStatus(status), actor);
  }

  @Post('revocations')
  @ApiOperation({ summary: 'Request revocation of an issued certificate' })
  @ApiConflictResponse({
    description:
      'The plot already has a pending revocation, or an open transfer (one procedure per plot, ' +
      'D80). Once recorded, the owner gets no status attestation until it closes (D82)',
  })
  async requestRevocation(@Body() dto: CreateRevocationDto, @CurrentActor() actor: Actor) {
    return this.revocations.request(dto, actor);
  }

  @Get('pending-changes')
  @ApiOperation({
    summary:
      'Issuance requests, approved transfers and pending revocations waiting for the next round',
    description:
      'Held items and items already in a draft are left out. A branch sees only its own area (D86).',
  })
  pendingChanges(@CurrentActor() actor: Actor) {
    return this.changeSets.pending(actor);
  }

  // The publishing round (D84) — issuances, transfers and revocations under one root,
  // two-phase flow (D43/D46), Metamask signs instead of the backend
  @Post('changesets')
  @CentralOnly()
  @ApiOperation({
    summary: 'Create a change-set draft (phase 1 of 2, central office only)',
    description:
      'Gathers every READY issuance request, approved transfer and pending revocation that is ' +
      'not held, projects the single root that applying all of them produces, and stores it as ' +
      'a durable draft. No Property or request row is modified until confirm. Sign the returned ' +
      'newRoot (and, when the round includes any revocations, the revocationCalldata for ' +
      'publishRootWithRevocations) with Metamask, then call confirm.',
  })
  @ApiConflictResponse({
    description:
      'Another draft is already open (D44), the queue holds conflicting procedures for one plot, ' +
      'or an issuance supersedes a certificate that is not REVOKED yet (reason ' +
      'PredecessorNotRevoked, D90)',
  })
  async createChangeSetDraft(@CurrentActor() actor: Actor) {
    return this.changeSets.createDraft(actor);
  }

  @Post('changesets/:id/confirm')
  @CentralOnly()
  @ApiOperation({
    summary: 'Confirm a change-set draft (phase 2 of 2, central office only)',
    description:
      'Re-reads latestRoot from the chain and applies the draft only if it matches. The ' +
      'request body carries no chain evidence on purpose — the optional txHash is a display ' +
      'label only, never trusted as proof the publish happened.',
  })
  async confirmChangeSetDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmDraftDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.changeSets.confirm(id, dto.txHash, actor);
  }

  @Delete('changesets/:id')
  @CentralOnly()
  @ApiOperation({ summary: 'Discard an unsigned change-set draft (central office only)' })
  async discardChangeSetDraft(@Param('id', ParseIntPipe) id: number) {
    await this.changeSets.discard(id);
    return { discarded: id };
  }

  @Get('changesets')
  @ApiOperation({
    summary: 'List change sets, newest first',
    description:
      'Summary columns plus issuance/transfer/revocation counts and how many of the round’s ' +
      'per-office archives exist and were downloaded — never archive bytes (D88).',
  })
  listChangeSets() {
    return this.changeSets.list();
  }

  @Get('changesets/:id/archives')
  @ApiOperation({
    summary: 'The round’s archives, one per land office (D88)',
    description:
      'A branch sees only its own office’s archive; the central office sees all of them. ' +
      'No zip bytes — download one via GET changesets/:id/archives/:officeCode.',
  })
  @ApiOkResponse({ type: [ArchiveSummaryDto] })
  roundArchivesOf(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.roundArchives.archivesOf(id, actor);
  }

  @Get('changesets/:id/archives/:officeCode')
  @ApiOperation({
    summary: 'Download one office’s bundles of the round as a ZIP, one folder per plot',
    description:
      'Each folder holds receipt.json, secret.json, certificate.pdf and README.txt; ' +
      'manifest.json ties the archive to a root version and tags each plot issued or ' +
      'transferred (D77, D84). A branch may download only its own office’s archive (403 ' +
      'OutsideOfficeArea otherwise); the central office may download any. Available until ' +
      'the archive’s expiresAt, then 410. The first successful download is stamped (D88).',
  })
  @ApiForbiddenResponse({ description: 'A branch asked for another office’s archive' })
  async downloadRoundArchive(
    @Param('id', ParseIntPipe) id: number,
    @Param('officeCode') officeCode: string,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    const { zip, filename } = await this.roundArchives.archiveFor(id, officeCode, actor);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.length),
    });
    res.end(zip);
  }

  @Get('archives')
  @ApiOperation({
    summary: 'Every round’s archives, newest first (D88)',
    description: 'A branch sees only its own office’s archives; the central office sees all.',
  })
  @ApiOkResponse({ type: [ArchiveSummaryDto] })
  allArchives(@CurrentActor() actor: Actor) {
    return this.roundArchives.archivesForActor(actor);
  }
}
