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
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
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
import { parsePageQuery } from '../common/pagination';
import { ChangeSetService } from './changeset.service';
import { GovernmentService, parsePropertyStatus } from './government.service';
import { ImportService } from '../import/import.service';
import { ImportResult } from '../import/dto/import.response.dto';
import { IssuanceBatchService } from '../issuance/issuance-batch.service';
import { ConfirmDraftDto } from './dto/confirm-draft.dto';
import { CreateIssuanceDraftDto } from './dto/issue-batch.dto';
import { CreateRevocationDto } from './dto/revocation.dto';
import {
  PropertyListResponseDto,
  PropertyDetailDto,
  RegistryStatusResponseDto,
} from './dto/government.response.dto';
import { OpenDraftService } from './open-draft.service';
import { RevocationService } from './revocation.service';

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
    private readonly issuanceBatches: IssuanceBatchService,
    private readonly revocations: RevocationService,
    private readonly changeSets: ChangeSetService,
    private readonly openDrafts: OpenDraftService,
  ) {}

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
      'tenure), encumbranceStatus. `useType` and `tenureType` are derived server-side from ' +
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
      'At most one draft exists across issuance batches and change sets (D44). Returns ' +
      '`{ draft: null }` when none is open; otherwise the same shape its create call returned — ' +
      'for a change set that includes the revocationCalldata to sign. This is how a portal ' +
      'resumes after losing the create response: compare `newRoot` with the on-chain ' +
      'latestRoot to decide between signing again and calling confirm.',
  })
  openDraft() {
    return this.openDrafts.current();
  }

  // Issuance draft — two-phase flow (D43), Metamask signs instead of the backend
  @Get('issuance-batches')
  @ApiOperation({
    summary: 'List issuance rounds, newest first',
    description:
      'Summary columns only — never draftSecrets (secret material, D14) or archiveZip ' +
      '(megabytes of ZIP, D42). Download the archive itself via GET issuance-batches/:id/archive.',
  })
  listIssuanceBatches() {
    return this.issuanceBatches.list();
  }

  @Post('issuance-batches')
  @ApiOperation({
    summary: 'Create an issuance draft (phase 1 of 2)',
    description:
      'Generates owner secrets, projects the new Merkle root, and stores everything as a ' +
      'durable draft. No Property row is modified until confirm. Sign the returned newRoot ' +
      'with Metamask, then call confirm.',
  })
  async createIssuanceDraft(@Body() dto: CreateIssuanceDraftDto) {
    return this.issuanceBatches.createDraft(dto.propertyIds);
  }

  @Post('issuance-batches/:id/confirm')
  @ApiOperation({
    summary: 'Confirm an issuance draft (phase 2 of 2)',
    description:
      'Re-reads latestRoot from the chain and applies the draft only if it matches. The ' +
      'request body carries no chain evidence on purpose — the optional txHash is a display ' +
      'label only, never trusted as proof the publish happened.',
  })
  async confirmIssuanceDraft(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmDraftDto) {
    return this.issuanceBatches.confirm(id, dto.txHash);
  }

  @Delete('issuance-batches/:id')
  @ApiOperation({ summary: 'Discard an unsigned issuance draft' })
  async discardIssuanceDraft(@Param('id', ParseIntPipe) id: number) {
    await this.issuanceBatches.discard(id);
    return { discarded: id };
  }

  @Get('issuance-batches/:id/archive')
  @ApiOperation({
    summary: 'Download the whole batch as one ZIP, one folder per property',
    description:
      'Each folder holds receipt.json, secret.json, certificate.pdf and README.txt; a ' +
      'manifest.json at the root ties the archive to a root version. Available until the ' +
      "batch's archiveExpiresAt, after which the secrets are unrecoverable and affected " +
      'plots must be re-issued.',
  })
  async downloadArchive(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { zip, filename } = await this.issuanceBatches.archiveFor(id);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.length),
    });
    res.end(zip);
  }

  @Post('revocations')
  @ApiOperation({ summary: 'Request revocation of an issued certificate' })
  async requestRevocation(@Body() dto: CreateRevocationDto) {
    return this.revocations.request(dto);
  }

  @Get('pending-changes')
  @ApiOperation({
    summary: 'Approved transfers and pending revocations waiting for the next change set',
  })
  pendingChanges() {
    return this.changeSets.pending();
  }

  // Change-set draft — batches approved transfers + pending revocations into
  // one root, two-phase flow (D44/D46), Metamask signs instead of the backend
  @Post('changesets')
  @ApiOperation({
    summary: 'Create a change-set draft (phase 1 of 2)',
    description:
      'Gathers every approved transfer and pending revocation, projects the single root that ' +
      'applying all of them produces, and stores it as a durable draft. No Property, ' +
      'TransferRequest or Revocation row is modified until confirm. Sign the returned newRoot ' +
      '(and, when the round includes any revocations, the revocationCalldata for ' +
      'publishRootWithRevocations) with Metamask, then call confirm.',
  })
  async createChangeSetDraft() {
    return this.changeSets.createDraft();
  }

  @Post('changesets/:id/confirm')
  @ApiOperation({
    summary: 'Confirm a change-set draft (phase 2 of 2)',
    description:
      'Re-reads latestRoot from the chain and applies the draft only if it matches. The ' +
      'request body carries no chain evidence on purpose — the optional txHash is a display ' +
      'label only, never trusted as proof the publish happened.',
  })
  async confirmChangeSetDraft(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmDraftDto) {
    return this.changeSets.confirm(id, dto.txHash);
  }

  @Delete('changesets/:id')
  @ApiOperation({ summary: 'Discard an unsigned change-set draft' })
  async discardChangeSetDraft(@Param('id', ParseIntPipe) id: number) {
    await this.changeSets.discard(id);
    return { discarded: id };
  }

  @Get('changesets')
  @ApiOperation({
    summary: 'List change sets, newest first',
    description:
      'Summary columns plus transfer/revocation counts — never archiveZip. Download the ' +
      'buyers’ archive via GET changesets/:id/archive (D77).',
  })
  listChangeSets() {
    return this.changeSets.list();
  }

  @Get('changesets/:id/archive')
  @ApiOperation({
    summary: 'Download the buyers’ bundles as one ZIP, one folder per transferred plot (D77)',
    description:
      'Each folder holds receipt.json, secret.json, certificate.pdf and README.txt — the same ' +
      'four files as an issuance folder; manifest.json ties the archive to a root version. ' +
      "Available until the change set's archiveExpiresAt. A round with only revocations has " +
      'no archive.',
  })
  async downloadChangeSetArchive(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { zip, filename } = await this.changeSets.archiveFor(id);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.length),
    });
    res.end(zip);
  }
}
