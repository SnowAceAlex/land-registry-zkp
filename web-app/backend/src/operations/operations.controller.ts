import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Actor } from '../common/actor';
import { ApiKeyGuard, GOV_API_KEY_HEADER, GOV_API_KEY_SECURITY } from '../common/api-key.guard';
import { CentralOnly } from '../common/central-only.guard';
import { CurrentActor } from '../common/current-actor.decorator';
import { pageArgs } from '../common/pagination';
import {
  HoldQueueItemDto,
  QueueItemDto,
  QueueListResponseDto,
  QueueQueryDto,
} from './dto/queue.dto';
import { OfficeRowDto, OverviewDto } from './dto/operations.dto';
import { OperationsService } from './operations.service';
import { QueueService } from './queue.service';

@ApiTags('Operations')
@ApiSecurity(GOV_API_KEY_SECURITY)
@ApiUnauthorizedResponse({ description: `Missing or invalid ${GOV_API_KEY_HEADER} header` })
@SkipThrottle()
@Controller('government')
@UseGuards(ApiKeyGuard)
export class OperationsController {
  constructor(
    private readonly queue: QueueService,
    private readonly operations: OperationsService,
  ) {}

  @Get('operations/overview')
  @ApiOperation({
    summary: 'Registry state, queue totals and coded alerts (D89)',
    description:
      'A branch gets its own area only: its queue totals and the alerts naming its office, ' +
      'plus ChainAheadOfDatabase. Answers 503 when the chain root cannot be read.',
  })
  @ApiOkResponse({ type: OverviewDto })
  overview(@CurrentActor() actor: Actor) {
    return this.operations.overview(actor);
  }

  @Get('operations/offices')
  @CentralOnly()
  @ApiOperation({
    summary: 'The queue by office: one row per office plus the unassigned plots (D89)',
    description: 'Counts follow the plot area, not the office that filed the item.',
  })
  @ApiOkResponse({ type: [OfficeRowDto] })
  @ApiForbiddenResponse({ description: 'CentralScopeRequired' })
  offices() {
    return this.operations.offices();
  }

  @Get('queue')
  @ApiOperation({
    summary: 'Open items of all three procedures, oldest first (D87)',
    description:
      'Open = issuance READY, transfer PENDING/APPROVED, revocation PENDING. A branch sees ' +
      'only its own area; naming another office answers 403 OutsideOfficeArea.',
  })
  @ApiOkResponse({ type: QueueListResponseDto })
  @ApiForbiddenResponse({ description: 'OutsideOfficeArea' })
  list(@Query() query: QueueQueryDto, @CurrentActor() actor: Actor) {
    const { skip, take } = pageArgs({ skip: query.skip, take: query.take });
    return this.queue.list({ ...query, skip, take }, actor);
  }

  @Post('queue/:kind/:id/hold')
  @HttpCode(200)
  @CentralOnly()
  @ApiOperation({
    summary: 'Keep an open item out of the next round (D87)',
    description: '`kind` is issuance, transfer or revocation. The item stays an open procedure.',
  })
  @ApiOkResponse({ type: QueueItemDto })
  @ApiForbiddenResponse({ description: 'CentralScopeRequired' })
  @ApiConflictResponse({ description: 'Not open, or ItemInOpenDraft' })
  hold(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HoldQueueItemDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.queue.hold(kind, id, body.reason, actor);
  }

  @Post('queue/:kind/:id/release')
  @HttpCode(200)
  @CentralOnly()
  @ApiOperation({ summary: 'Put a held item back into the next round (D87)' })
  @ApiOkResponse({ type: QueueItemDto })
  @ApiForbiddenResponse({ description: 'CentralScopeRequired' })
  @ApiConflictResponse({ description: 'Not open, or ItemInOpenDraft' })
  release(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @CurrentActor() actor: Actor,
  ) {
    return this.queue.release(kind, id, actor);
  }

  @Post('queue/:kind/:id/withdraw')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Withdraw an open item (D87)',
    description:
      'Issuance (READY) and transfer (APPROVED only; a PENDING one is rejected through ' +
      '/transfers/:id/reject): central only. Revocation (PENDING): central, or the branch ' +
      'that owns the plot. Secrets held for the item are deleted.',
  })
  @ApiOkResponse({ type: QueueItemDto })
  @ApiForbiddenResponse({ description: 'CentralScopeRequired or OutsideOfficeArea' })
  @ApiConflictResponse({ description: 'Not open, PENDING transfer, or ItemInOpenDraft' })
  withdraw(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @CurrentActor() actor: Actor,
  ) {
    return this.queue.withdraw(kind, id, actor);
  }
}
