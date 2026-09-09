import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RecordsService } from './records.service';
import { parsePageQuery } from '../common/pagination';
import { RecordListResponseDto, RecordPublicDto } from './dto/record.response.dto';

/**
 * RecordsController
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only REST access to Land Use Rights (LUR) records.
 * Base path: /api/records
 *
 * Two tiers, deliberately not one. `GET /` and `GET /:propertyId` here stay
 * unauthenticated — but they now return only `RecordPublicDto`
 * (propertyId/ownerCommitment/status/leaf/rootVersion), every field of which
 * is already public via another route or the chain itself. The full row —
 * descriptive certificate fields (address, area, certificate serial, book
 * entry number, …) and internal bookkeeping columns — is only available
 * behind `ApiKeyGuard`, via `GET /api/government/properties` and
 * `GET /api/government/properties/:propertyId`. Before this split, both
 * routes here returned the whole database row unauthenticated: anyone could
 * `GET /api/records?take=200` and download the contents of every land
 * certificate, which defeats the point of proving facts with `mortgage.circom`
 * instead of disclosing `encumbranceStatus`/`validityPeriod` outright.
 *
 * The write routes exist but return 501 on purpose: editing a record changes
 * its leaf and therefore the Merkle root, so it has to go through the
 * government flow that rebuilds and publishes in the same operation. They are
 * kept (and documented as such) rather than deleted so the reason is visible.
 */
@ApiTags('Records')
@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  @ApiOperation({ summary: 'List records (paginated) — public projection only' })
  @ApiQuery({ name: 'skip', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'take', required: false, type: Number, example: 50, description: 'Max 200' })
  @ApiOkResponse({ type: RecordListResponseDto })
  findAll(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.recordsService.findAll(parsePageQuery(skip, take));
  }

  @Get(':propertyId')
  @ApiOperation({ summary: 'Get one record by propertyId — public projection only' })
  @ApiParam({ name: 'propertyId', example: '1', description: 'Decimal-string id' })
  @ApiOkResponse({ type: RecordPublicDto })
  findById(@Param('propertyId') propertyId: string) {
    return this.recordsService.findById(propertyId);
  }

  @Post()
  @ApiOperation({
    summary: 'Not implemented — returns 501',
    description: 'Create records via POST /api/government/import so the root stays in sync.',
    deprecated: true,
  })
  create(@Body() body: Record<string, unknown>) {
    return this.recordsService.create(body);
  }

  @Put(':propertyId')
  @ApiOperation({
    summary: 'Not implemented — returns 501',
    description:
      'Editing a record changes its leaf hash; use the government endpoints, which rebuild the ' +
      'tree and publish a new root in the same operation.',
    deprecated: true,
  })
  update(@Param('propertyId') propertyId: string, @Body() body: Record<string, unknown>) {
    return this.recordsService.update(propertyId, body);
  }

  @Delete(':propertyId')
  @ApiOperation({
    summary: 'Not implemented — returns 501',
    description: 'Records are never deleted; the registry only deactivates state (D29).',
    deprecated: true,
  })
  remove(@Param('propertyId') propertyId: string) {
    return this.recordsService.remove(propertyId);
  }
}
