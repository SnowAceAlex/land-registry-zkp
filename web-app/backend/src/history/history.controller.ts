import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { LineageService } from '../lineage/lineage.service';
import { PropertyEventService } from './property-event.service';
import { toPropertyEventDto } from './property-event.serializer';
import { LineageResponseDto, PropertyHistoryResponseDto } from './dto/history.response.dto';

/**
 * HistoryController — the public change log of one plot (D48).
 *
 * Deliberately unguarded, on the same reasoning as D39: every field returned is
 * either a pseudonymous commitment (D8), a Poseidon hash, or — for a REVOKED
 * event's `detail` — the small on-chain reason code plus keccak256(detailText).
 * The free-text revocation reason itself is never returned here: the design
 * deliberately keeps it off the blockchain (a permanent public record of *why*
 * a specific plot lost its certificate is legally sensitive), so this endpoint
 * must not become the leak that undoes that. With that guarantee, this
 * discloses nothing that `GET /api/records/:propertyId` does not already
 * disclose. A buyer being able to check a plot's history themselves — rather
 * than taking an officer's word for it — is the point.
 */
@ApiTags('Records')
@Controller('records')
export class HistoryController {
  constructor(
    private readonly events: PropertyEventService,
    private readonly lineage: LineageService,
  ) {}

  @Get(':propertyId/history')
  @ApiOperation({
    summary: 'Public change history of one property',
    description:
      'Every change that altered the leaf: issuance, transfer, revocation, encumbrance and ' +
      'validity changes. Oldest first, plus the direct predecessor and successor ' +
      'certificates (D90). No authentication — the data is pseudonymous.',
  })
  async history(@Param('propertyId') propertyId: string): Promise<PropertyHistoryResponseDto> {
    const [events, predecessors, successors] = await Promise.all([
      this.events.listFor(propertyId),
      this.lineage.predecessorsOf([propertyId]),
      this.lineage.successorsOf([propertyId]),
    ]);
    return {
      propertyId,
      events: events.map(toPropertyEventDto),
      lineage: {
        predecessors: predecessors.get(propertyId) ?? [],
        successors: successors.get(propertyId) ?? [],
      },
    };
  }

  // D90: the chain of certificates across re-issues; links only ids that are already public.
  @Get(':propertyId/lineage')
  @ApiOperation({
    summary: 'Chain of certificates a property was re-issued through',
    description:
      'Ancestors (negative generation) and descendants (positive) of one certificate, each ' +
      'with its status and history. Capped at 200 nodes; `truncated` says when it was cut.',
  })
  @ApiNotFoundResponse({ description: 'No such property' })
  async lineageOf(@Param('propertyId') propertyId: string): Promise<LineageResponseDto> {
    const result = await this.lineage.lineageOf(propertyId);
    if (!result) throw new NotFoundException(`Property ${propertyId} not found`);
    return result;
  }
}
