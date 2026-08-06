import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
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

import { ApiKeyGuard } from './api-key.guard';
import { GovernmentService } from './government.service';
import { ImportService } from './import.service';
import { ImportResult, IssueBatchDto } from './dto/import.dto';
import {
  IssueBatchResponseDto,
  PropertyListResponseDto,
  PublishRootResponseDto,
  RegistryStatusResponseDto,
} from './dto/government.response.dto';
import { GOV_API_KEY_SECURITY } from '../swagger';

@ApiTags('Government')
@ApiSecurity(GOV_API_KEY_SECURITY)
@ApiUnauthorizedResponse({ description: 'Missing or invalid x-gov-api-key header' })
@Controller('government')
@UseGuards(ApiKeyGuard)
export class GovernmentController {
  constructor(
    private readonly government: GovernmentService,
    private readonly importService: ImportService,
  ) { }

  @Get('status')
  @ApiOperation({
    summary: 'Registry state on chain vs. in the database',
    description:
      'Use `inSync` as the health check while testing: false means the chain was restarted ' +
      'or redeployed while the database kept its rows. Publishing a root reconciles them.',
  })
  @ApiOkResponse({ type: RegistryStatusResponseDto })
  status() {
    return this.government.registryStatus();
  }

  @Get('properties')
  @ApiOperation({ summary: 'List properties with their issuance status' })
  @ApiQuery({ name: 'skip', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'take', required: false, type: Number, example: 50, description: 'Max 200' })
  @ApiOkResponse({ type: PropertyListResponseDto })
  listProperties(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.government.listProperties({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
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
      'Sample file: blockchain/fixtures/mockImport.csv.',
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
  async import(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("Upload a CSV file in the 'file' field");
    }
    return this.importService.importCsv(file.buffer.toString('utf8'));
  }

  // Issue a batch
  @Post('issue-batch')
  @ApiOperation({
    summary: 'Issue a batch of properties (one publishRoot transaction)',
    description:
      'Generates an ownerSecret per property, publishes ONE root covering the whole batch, ' +
      'refreshes the cached Merkle proof of every issued property, and returns a single-use ' +
      'download link per owner. The secrets exist only inside those bundles — the response ' +
      'is the one chance to collect them (D14/D34).',
  })
  @ApiOkResponse({ type: IssueBatchResponseDto })
  issueBatch(@Body() dto: IssueBatchDto) {
    return this.government.issueBatch(dto.propertyIds);
  }

  // Publish root
  @Post('publish-root')
  @ApiOperation({
    summary: 'Rebuild the tree from the database and publish',
    description:
      'Returns `published: false` without sending a transaction when the rebuilt root already ' +
      'matches the chain — RootRegistry rejects re-publishing the current root (DuplicateRoot).',
  })
  @ApiOkResponse({ type: PublishRootResponseDto })
  publishRoot() {
    return this.government.publishRoot();
  }
}
